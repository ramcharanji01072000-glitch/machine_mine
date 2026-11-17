const mongoose = require('mongoose');
const { autoIncrement } = require('./Counter');

const schema = new mongoose.Schema(
  {
    userId: { type: Number, required: true, index: true },
    productId: { type: Number, required: true, index: true },
    productType: { type: String, default: 'Normal' },
    // Snapshot of the product terms at purchase time, so later edits don't change payouts.
    productName: String,
    pricePaise: Number,
    totalReturnPaise: Number,
    durationDays: Number,
    lastClaimAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    claimedPaise: { type: Number, default: 0 },
  },
  { timestamps: true, id: false }
);
autoIncrement(schema, 'purchase');

module.exports = mongoose.model('Purchase', schema);
