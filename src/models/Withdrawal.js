const mongoose = require('mongoose');
const { autoIncrement } = require('./Counter');

const schema = new mongoose.Schema(
  {
    userId: { type: Number, required: true, index: true },
    bankId: Number,
    bank: { bankName: String, bankAccount: String, fullName: String, ifsc: String, phoneNumber: String },
    amountPaise: { type: Number, required: true }, // gross: debited from the wallet
    taxPercent: { type: Number, default: 0 }, // rate applied at request time
    taxPaise: { type: Number, default: 0 },
    netPaise: Number, // amount to actually pay the user (gross - tax); missing on old records = gross
    transactionNumber: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    remark: String,
    processedAt: Date,
  },
  { timestamps: true, id: false }
);
autoIncrement(schema, 'withdrawal');

module.exports = mongoose.model('Withdrawal', schema);
