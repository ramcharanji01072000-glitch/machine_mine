const mongoose = require('mongoose');
const { autoIncrement } = require('./Counter');

// Modes the app UI colours: Recharge, Collect, Withdraw, WithdrawFailure, Buy.
// Extra modes: Referral, Bonus, Deduct.
const MODES = ['Recharge', 'Collect', 'Withdraw', 'WithdrawFailure', 'Buy', 'Referral', 'Bonus', 'Deduct'];

const schema = new mongoose.Schema(
  {
    userId: { type: Number, required: true, index: true },
    mode: { type: String, required: true, enum: MODES, index: true },
    amountPaise: { type: Number, required: true },
    previousPaise: Number,
    updatedPaise: Number,
    note: String,
    refId: Number, // purchase / withdrawal id
    fromUserId: Number, // referral source user
    level: Number, // referral level 1..3
  },
  { timestamps: true, id: false }
);
autoIncrement(schema, 'transaction');

const Transaction = mongoose.model('Transaction', schema);
Transaction.MODES = MODES;
module.exports = Transaction;
