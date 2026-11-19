// Wallet recharge through the YouPI UPI gateway. Mounted at /api/v1/pay
const router = require('express').Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { GatewayPayment } = require('../../models');
const { ok, fail, wrap } = require('../../utils/respond');
const { requireUser } = require('../../middleware/auth');
const { toPaise, fmt } = require('../../utils/money');
const youpi = require('../../services/youpi');

const view = (gp) => ({
  id: gp.id,
  order_id: gp.orderId,
  amount: fmt(gp.amountPaise),
  status: gp.status,
  credited: Boolean(gp.creditedAt),
  checkout_url: gp.status === 'active' ? gp.checkoutUrl : null,
  error: gp.status === 'error' ? gp.error : null,
  created_at: gp.createdAt,
});

// Signed callback from the gateway. No user auth: authenticity comes from the HMAC signature.
router.post(
  '/youpi/webhook',
  wrap(async (req, res) => {
    const c = await youpi.config();
    let payload;
    try {
      payload = youpi.verifyWebhook(req.rawBody || '', req.headers, c.webhookSecret);
    } catch (e) {
      console.warn('[youpi] webhook rejected:', e.message);
      return res.status(400).json({ received: false, error: 'invalid signature' });
    }
    const { result } = await youpi.handleWebhook(payload, String(req.headers['x-gateway-delivery-id'] || '') || null);
    console.log(`[youpi] ${payload.event} ${payload.orderId || payload.paymentId}: ${result}`);
    return res.status(200).json({ received: true, result });
  })
);

router.use(requireUser);

// Whether in-app UPI recharge is available, and its limits.
router.get(
  '/config',
  wrap(async (req, res) => {
    const c = await youpi.config();
    const enabled = Boolean(c.enabled && youpi.isConfigured(c));
    return ok(res, 'Payment config', { enabled, min: fmt(c.minPaise), max: fmt(c.maxPaise) });
  })
);

const createLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => String(req.user.id),
  handler: (req, res) => fail(res, 'Too many recharge attempts, please wait a few minutes', 429),
});

// Body: { amount } -> { id, checkout_url, ... }. Open checkout_url for the user to pay by UPI.
router.post(
  '/recharge',
  createLimiter,
  wrap(async (req, res) => {
    const c = await youpi.config();
    if (!c.enabled || !youpi.isConfigured(c)) return fail(res, 'Online recharge is not available right now. Please contact support.');
    const amount = toPaise(req.body?.amount);
    if (!Number.isInteger(amount) || amount <= 0) return fail(res, 'Enter a valid amount');
    if (amount < c.minPaise) return fail(res, `Minimum recharge is ₹${fmt(c.minPaise)}`);
    if (amount > c.maxPaise) return fail(res, `Maximum recharge is ₹${fmt(c.maxPaise)}`);

    const gp = await GatewayPayment.create({
      userId: req.user.id,
      amountPaise: amount,
      orderId: `MM${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    });
    try {
      await youpi.createPayment(gp, req.user, null);
    } catch (e) {
      gp.status = 'error';
      gp.error = e.name === 'TimeoutError' ? 'Gateway timed out' : e.message;
      await gp.save();
    }
    if (gp.status !== 'active') return fail(res, 'Could not start the payment. Please try again later.', 502, view(gp));
    return ok(res, 'Payment created. Complete it on the checkout page.', view(gp), 201);
  })
);

router.get(
  '/recharge/:id',
  wrap(async (req, res) => {
    const gp = await GatewayPayment.findOne({ id: Number(req.params.id), userId: req.user.id });
    if (!gp) return fail(res, 'Recharge not found', 404);
    await youpi.refreshStatus(gp);
    return ok(res, 'Recharge status', view(gp));
  })
);

router.get(
  '/recharges',
  wrap(async (req, res) => {
    const list = await GatewayPayment.find({ userId: req.user.id }).sort({ id: -1 }).limit(50);
    return ok(res, 'Recharges', list.map(view));
  })
);

module.exports = router;
