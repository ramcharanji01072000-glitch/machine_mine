// Shapes documents exactly as the Flutter models (lib/data/model/response/*) expect.
const { fmt } = require('./money');

const Setting = require('../models/Setting');

const iso = (d) => (d ? new Date(d).toISOString() : null);

// Human label for a tax's rate: "₹10.00" or "2%".
const taxRate = (t) => (t.type === 'fixed' ? `₹${fmt(t.value)}` : `${t.value}%`);

function user(u, token) {
  const out = {
    id: u.id,
    name: u.name,
    email: u.email || null,
    mobile: u.mobile,
    invite_code: u.inviteCode,
    created_at: iso(u.createdAt),
    referred_by: u.referredBy || null,
    balance: fmt(u.balancePaise),
  };
  if (token) out.token = token;
  return out;
}

function product(p) {
  const daily = p.durationDays ? Math.round(p.totalReturnPaise / p.durationDays) : 0;
  return {
    id: p.id,
    product_name: p.name,
    product_image: p.image || null,
    price: fmt(p.pricePaise),
    di: fmt(daily),
    du: String(p.durationDays),
    tr: fmt(p.totalReturnPaise),
    type: p.type,
    created_at: iso(p.createdAt),
  };
}

function purchase(p) {
  return {
    id: p.id,
    userId: p.userId,
    productId: p.productId,
    productType: p.productType,
    isExpired: new Date() >= p.expiresAt ? 1 : 0,
    c_date_time: iso(p.lastClaimAt),
    createdAt: iso(p.createdAt),
    expiresAt: iso(p.expiresAt),
    claimed: fmt(p.claimedPaise),
  };
}

function transaction(t) {
  return {
    id: t.id,
    amount: fmt(t.amountPaise),
    mode: t.mode,
    updatedAt: iso(t.createdAt),
    updatedAmount: fmt(t.updatedPaise),
    previousAmount: fmt(t.previousPaise),
    userId: t.userId,
    note: t.note || null,
  };
}

function bank(b) {
  return {
    id: b.id,
    userId: b.userId,
    phone_number: b.phoneNumber,
    bank_name: b.bankName,
    bank_account: b.bankAccount,
    full_name: b.fullName,
    ifsc: b.ifsc,
    created_at: iso(b.createdAt),
  };
}

function withdrawal(w) {
  return {
    id: w.id,
    userId: w.userId,
    bankId: w.bankId,
    amount: fmt(w.amountPaise),
    tax_percent: w.taxPercent || 0,
    taxes: (w.taxes && w.taxes.length
      ? w.taxes
      : w.taxPaise ? [{ name: 'Tax', type: 'percent', value: w.taxPercent, amountPaise: w.taxPaise }] : []
    ).map((t) => ({ name: t.name, type: t.type, rate: taxRate(t), amount: fmt(t.amountPaise) })),
    tax: fmt(w.taxPaise || 0),
    net_amount: fmt(w.netPaise ?? w.amountPaise),
    transactionNumber: w.transactionNumber,
    status: w.status,
    remark: w.remark || null,
    created_at: iso(w.createdAt),
    processed_at: iso(w.processedAt),
  };
}

function carousel(c) {
  return {
    _id: String(c._id),
    image: c.image,
    caption: c.caption || '',
    order: c.order,
    status: c.status ? 1 : 0,
    routes: c.routes || '',
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
    __v: c.__v || 0,
  };
}

function appInfo(s) {
  return {
    id: 1,
    logo: s.logo || null,
    android_link: s.androidLink || null,
    ios_link: s.iosLink || null,
    about_us: s.aboutUs || '',
    telegram: s.telegram || null,
    referral_level1: s.referralLevel1,
    referral_level2: s.referralLevel2,
    referral_level3: s.referralLevel3,
    min_withdraw: fmt(s.minWithdrawPaise),
    // [{ name, type: 'fixed'|'percent', value }] — value is rupees for fixed, % for percent.
    withdraw_taxes: Setting.withdrawTaxesOf(s).map((t) => ({
      name: t.name,
      type: t.type,
      value: t.type === 'fixed' ? Number(fmt(t.value)) : t.value,
    })),
    // Legacy (older app builds): sum of percentage taxes only.
    withdraw_tax_percent: Setting.withdrawTaxesOf(s).filter((t) => t.type === 'percent').reduce((a, t) => a + t.value, 0),
    terms: s.terms || '',
    created_at: iso(s.createdAt),
  };
}

module.exports = { user, product, purchase, transaction, bank, withdrawal, carousel, appInfo, iso };
