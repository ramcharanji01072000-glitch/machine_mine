const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    _id: { type: String, default: 'app' },
    logo: String, // /uploads/... path, shown on the app's splash, login and about screens
    androidLink: String,
    iosLink: String,
    aboutUs: { type: String, default: '' },
    telegram: String,
    referralLevel1: { type: Number, default: 10 }, // % of product price paid to the direct referrer
    referralLevel2: { type: Number, default: 5 },
    referralLevel3: { type: Number, default: 2 },
    minWithdrawPaise: { type: Number, default: 20000 },
    // Taxes deducted from each withdrawal, applied in order.
    //   type 'fixed'   -> value is paise (₹10 = 1000)
    //   type 'percent' -> value is a percentage of the withdrawal amount
    withdrawTaxes: {
      type: [{ _id: false, name: String, type: { type: String, enum: ['fixed', 'percent'] }, value: Number }],
      default: [],
    },
    withdrawTaxPercent: { type: Number, default: 0, min: 0, max: 100 }, // legacy single tax, read via withdrawTaxesOf()
    terms: { type: String, default: '' }, // Terms & Conditions shown in the app and at /terms
    signupBonusPaise: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Single settings document, created with defaults on first access.
schema.statics.get = function () {
  return this.findByIdAndUpdate('app', {}, { new: true, upsert: true, setDefaultsOnInsert: true });
};

const Setting = mongoose.model('Setting', schema);

/** Configured withdrawal taxes. Falls back to the legacy single-% setting. */
Setting.withdrawTaxesOf = (s) => {
  const list = (s.withdrawTaxes || []).filter((t) => t && t.name && t.value > 0);
  if (list.length) return list.map((t) => ({ name: t.name, type: t.type, value: t.value }));
  return s.withdrawTaxPercent > 0 ? [{ name: 'Tax', type: 'percent', value: s.withdrawTaxPercent }] : [];
};

/** Itemised taxes for a withdrawal of `amountPaise`: [{name, type, value, amountPaise}], total, net. */
Setting.applyWithdrawTaxes = (taxes, amountPaise) => {
  const items = taxes.map((t) => ({
    name: t.name,
    type: t.type,
    value: t.value,
    amountPaise: t.type === 'fixed' ? Math.round(t.value) : Math.round((amountPaise * t.value) / 100),
  }));
  const total = items.reduce((a, t) => a + t.amountPaise, 0);
  return { items, total, net: amountPaise - total };
};

module.exports = Setting;
