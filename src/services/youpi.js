// YouPI payment gateway integration (we are a merchant of a self-hosted YouPI instance).
// Contract: openapi.yaml + docs/MERCHANT_INTEGRATION.md of github.com/youpi-pg/YouPI-PG.
//   POST {base}/api/v1/payments        headers X-Merchant-Id, X-Merchant-Key  -> { paymentId, checkoutUrl, ... }
//   GET  {base}/api/v1/payments/:id    -> { status, ... }
//   Webhook -> POST {our}/api/v1/pay/youpi/webhook, signed HMAC-SHA256 with the merchant webhook secret.
const crypto = require('crypto');
const { Setting, GatewayPayment } = require('../models');
const { credit } = require('./wallet');
const { fmt } = require('../utils/money');

const TIMEOUT_MS = 10000;
const WEBHOOK_TOLERANCE_MS = 2 * 60 * 60 * 1000; // covers the gateway's retry schedule (same as its SDK)

async function config() {
  const s = await Setting.get();
  return s.youpi || {};
}

function isConfigured(c) {
  return Boolean(c && c.baseUrl && c.merchantId && c.apiKey && c.webhookSecret);
}

function baseUrl(c) {
  return String(c.baseUrl || '').replace(/\/+$/, '');
}

async function call(c, method, path, body) {
  const headers = { Accept: 'application/json', 'X-Merchant-Id': c.merchantId, 'X-Merchant-Key': c.apiKey };
  if (body) headers['Content-Type'] = 'application/json';
  const started = Date.now();
  const res = await fetch(baseUrl(c) + path, {
    method,
    headers: body?.idempotencyKey ? { ...headers, 'Idempotency-Key': body.idempotencyKey } : headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, ms: Date.now() - started };
}

/** Creates the gateway payment for a GatewayPayment row; returns the updated row. */
async function createPayment(gp, user, returnUrl) {
  const c = await config();
  const { status, data } = await call(c, 'POST', '/api/v1/payments', {
    orderId: gp.orderId,
    amount: fmt(gp.amountPaise),
    currency: 'INR',
    description: `Wallet recharge #${gp.id}`,
    customer: { name: user.name, phoneNumber: String(user.mobile || '').replace(/\D/g, '').slice(-10) },
    returnUrl: returnUrl || undefined,
    metadata: { source: 'machinemine', userId: user.id, rechargeId: gp.id },
    idempotencyKey: `mm-${gp.orderId}`,
  });
  if ((status === 200 || status === 201) && data?.paymentId && data?.checkoutUrl) {
    gp.gatewayPaymentId = data.paymentId;
    gp.checkoutUrl = data.checkoutUrl;
    gp.status = 'active';
  } else {
    gp.status = 'error';
    gp.error = (data && (data.error || data.message)) || `Gateway returned HTTP ${status}`;
  }
  await gp.save();
  return gp;
}

/** Display-only refresh of a payment's lifecycle from the gateway (never credits). */
async function refreshStatus(gp) {
  if (!gp.gatewayPaymentId || ['reconciled', 'failed', 'expired', 'cancelled'].includes(gp.status)) return gp;
  const c = await config();
  try {
    const { status, data } = await call(c, 'GET', `/api/v1/payments/${encodeURIComponent(gp.gatewayPaymentId)}`);
    if (status === 200 && data?.status) {
      const map = { FAILED: 'failed', EXPIRED: 'expired', CANCELLED: 'cancelled' };
      if (map[data.status] && !gp.creditedAt) {
        gp.status = map[data.status];
        await gp.save();
      }
    }
  } catch {
    /* gateway unreachable: keep last known status */
  }
  return gp;
}

/** Verifies a webhook. Throws with a reason, or returns the parsed payload. */
function verifyWebhook(rawBody, headers, secret) {
  if (!secret) throw new Error('webhook secret not configured');
  const sigHeader = String(headers['x-gateway-signature'] || '');
  if (!sigHeader.startsWith('sha256=')) throw new Error('missing or malformed X-Gateway-Signature');
  const given = Buffer.from(sigHeader.slice(7), 'hex');
  const hmac = (data) => crypto.createHmac('sha256', secret).update(data, 'utf8').digest();
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

  const ts = headers['x-gateway-timestamp'] !== undefined ? String(headers['x-gateway-timestamp']).trim() : null;
  if (ts !== null) {
    const n = Number(ts);
    if (!Number.isFinite(n) || Math.abs(Date.now() - n) > WEBHOOK_TOLERANCE_MS) throw new Error('timestamp outside tolerance');
  }
  const ok = same(given, hmac(rawBody)) || (ts !== null && same(given, hmac(`${ts}.${rawBody}`)));
  if (!ok) throw new Error('signature mismatch');

  const payload = JSON.parse(rawBody);
  if (payload && payload.timestamp != null) {
    const bodyTs = Number(payload.timestamp);
    if (!Number.isFinite(bodyTs) || Math.abs(Date.now() - bodyTs) > WEBHOOK_TOLERANCE_MS) throw new Error('payload timestamp outside tolerance');
    if (ts !== null && ts !== String(payload.timestamp).trim()) throw new Error('timestamp header does not match payload');
  }
  return payload;
}

/** Credits the wallet once. Returns true if this call did the credit. */
async function creditOnce(gp, by) {
  // Atomic claim: only one caller can move creditedAt from null to a date.
  const claimed = await GatewayPayment.findOneAndUpdate(
    { _id: gp._id, creditedAt: null },
    { $set: { creditedAt: new Date(), creditedBy: by } },
    { new: true }
  );
  if (!claimed) return false;
  try {
    const txn = await credit(gp.userId, gp.amountPaise, 'Recharge', {
      note: `UPI recharge via gateway · order ${gp.orderId}${by.startsWith('admin') ? ' · approved by admin' : ''}`,
      refId: gp.id,
    });
    claimed.creditTxnId = txn.id;
    await claimed.save();
    return true;
  } catch (e) {
    await GatewayPayment.updateOne({ _id: gp._id }, { $set: { creditedAt: null, creditedBy: null, error: `credit failed: ${e.message}` } });
    throw e;
  }
}

const EVENT_STATUS = {
  OBSERVED_SUCCESS: 'observed',
  RECONCILED: 'reconciled',
  MANUAL_REVIEW: 'manual_review',
  FAILED: 'failed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
};

/**
 * Applies a verified webhook. Returns { result } for logging.
 * Credits only for UPI payments whose amount matches, on RECONCILED (always) or
 * OBSERVED_SUCCESS (only when the admin chose "observed"). Never on SUCCESS (COD/counter).
 */
async function handleWebhook(payload, deliveryId) {
  const event = String(payload.event || '');
  const gp =
    (payload.orderId && (await GatewayPayment.findOne({ orderId: String(payload.orderId) }))) ||
    (payload.paymentId && (await GatewayPayment.findOne({ gatewayPaymentId: String(payload.paymentId) })));
  if (!gp) return { result: 'unknown order' };

  if (deliveryId && gp.events.some((e) => e.deliveryId === deliveryId)) return { result: 'duplicate delivery' };
  gp.events.push({ event, deliveryId: deliveryId || undefined, settlementState: payload.settlementState });
  if (!gp.gatewayPaymentId && payload.paymentId) gp.gatewayPaymentId = String(payload.paymentId);
  if (payload.verificationLevel != null) gp.verificationLevel = Number(payload.verificationLevel);
  if (payload.settlementState) gp.settlementState = String(payload.settlementState);
  // Don't downgrade a reconciled/credited payment with a late or out-of-order event.
  if (EVENT_STATUS[event] && !(gp.status === 'reconciled' && event !== 'RECONCILED')) gp.status = EVENT_STATUS[event];
  await gp.save();

  const c = await config();
  const amountOk = Number(payload.amountPaise) === gp.amountPaise;
  const upi = !payload.method || String(payload.method).toUpperCase() === 'UPI';
  const creditable =
    (event === 'RECONCILED' && payload.settlementState === 'RECONCILED') ||
    (event === 'OBSERVED_SUCCESS' && c.creditOn === 'observed');
  if (!creditable) return { result: `recorded ${event}` };
  if (!upi) return { result: 'not credited: non-UPI method' };
  if (!amountOk) {
    await GatewayPayment.updateOne({ _id: gp._id }, { $set: { status: 'manual_review', error: `amount mismatch: gateway ${payload.amountPaise} vs order ${gp.amountPaise} paise` } });
    return { result: 'not credited: amount mismatch' };
  }
  const did = await creditOnce(gp, 'webhook');
  return { result: did ? 'credited' : 'already credited' };
}

/** Runs the admin "Check integration" checklist. Never creates a payment. */
async function checkIntegration(ourWebhookUrl) {
  const c = await config();
  const checks = [];
  const add = (key, label, ok, detail) => checks.push({ key, label, ok, detail });

  // 1. Configuration
  const missing = ['baseUrl', 'merchantId', 'apiKey', 'webhookSecret'].filter((k) => !c[k]);
  let urlOk = false;
  try {
    const u = new URL(c.baseUrl);
    urlOk = u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    urlOk = false;
  }
  add('config', 'Settings complete', missing.length === 0 && urlOk,
    missing.length ? `Missing: ${missing.join(', ')}` : urlOk ? 'All fields set' : 'Gateway URL is not a valid http(s) URL');
  if (c.baseUrl && urlOk && new URL(c.baseUrl).protocol !== 'https:') {
    add('https', 'Gateway uses HTTPS', false, 'Use https:// in production so the API key is not sent in clear text.');
  }

  // 2. Reachability
  if (urlOk) {
    try {
      const started = Date.now();
      const res = await fetch(`${baseUrl(c)}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      add('health', 'Gateway reachable (/health)', res.ok, `HTTP ${res.status} in ${Date.now() - started} ms`);
    } catch (e) {
      add('health', 'Gateway reachable (/health)', false, e.name === 'TimeoutError' ? 'Timed out after 10 s' : e.message);
    }

    // 3. Merchant credentials. A create request WITHOUT an amount is rejected after the
    // merchant/key checks but before any session is created:
    //   400 "Missing required fields" => id + key valid; 401 => bad key; 400 "Merchant not found" => bad id.
    if (c.merchantId && c.apiKey) {
      try {
        const { status, data, ms } = await call(c, 'POST', '/api/v1/payments', { orderId: `MM-CHECK-${Date.now()}` });
        const msg = String(data?.error || data?.message || '');
        if (status === 400 && /missing required fields/i.test(msg)) add('auth', 'Merchant ID & API key accepted', true, `Verified in ${ms} ms (no payment created)`);
        else if (status === 401) add('auth', 'Merchant ID & API key accepted', false, `Rejected: ${msg || 'invalid merchant key'}`);
        else if (/merchant not found/i.test(msg)) add('auth', 'Merchant ID & API key accepted', false, 'Merchant ID not found on the gateway');
        else add('auth', 'Merchant ID & API key accepted', false, `Unexpected response: HTTP ${status} ${msg}`.trim());
      } catch (e) {
        add('auth', 'Merchant ID & API key accepted', false, e.message);
      }
    }
  }

  // 4. Webhook signing round-trip with our own verifier.
  if (c.webhookSecret) {
    try {
      const ts = String(Date.now());
      const raw = JSON.stringify({ event: 'PING', timestamp: ts });
      const sig = crypto.createHmac('sha256', c.webhookSecret).update(`${ts}.${raw}`, 'utf8').digest('hex');
      verifyWebhook(raw, { 'x-gateway-signature': `sha256=${sig}`, 'x-gateway-timestamp': ts }, c.webhookSecret);
      add('webhook', 'Webhook signature verification', true, 'Signed test event verified with your webhook secret');
    } catch (e) {
      add('webhook', 'Webhook signature verification', false, e.message);
    }
  }
  add('webhookUrl', 'Webhook URL to set in YouPI', /^https:\/\//.test(ourWebhookUrl), ourWebhookUrl +
    (/^https:\/\//.test(ourWebhookUrl) ? '' : ' — YouPI requires a public https URL'));

  const result = { at: new Date(), ok: checks.every((x) => x.ok), checks };
  await Setting.updateOne({ _id: 'app' }, { $set: { 'youpi.lastCheck': result } });
  return result;
}

module.exports = { config, isConfigured, createPayment, refreshStatus, verifyWebhook, handleWebhook, creditOnce, checkIntegration };
