const mongoose = require('mongoose');
const { autoIncrement } = require('./Counter');

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    mobile: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    withdrawalPassword: { type: String, required: true },
    inviteCode: { type: String, required: true, unique: true, uppercase: true },
    referredBy: { type: String, default: null }, // invite code of the referrer
    referrerId: { type: Number, default: null, index: true },
    question: String,
    answer: String, // bcrypt hash
    balancePaise: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 }, // bump to invalidate issued tokens
    lastLoginAt: Date,
  },
  { timestamps: true, id: false }
);
autoIncrement(schema, 'user');

module.exports = mongoose.model('User', schema);
