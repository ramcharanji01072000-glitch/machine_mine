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
    signupBonusPaise: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Single settings document, created with defaults on first access.
schema.statics.get = function () {
  return this.findByIdAndUpdate('app', {}, { new: true, upsert: true, setDefaultsOnInsert: true });
};

module.exports = mongoose.model('Setting', schema);
