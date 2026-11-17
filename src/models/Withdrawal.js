const mongoose = require('mongoose');
const { autoIncrement } = require('./Counter');

const schema = new mongoose.Schema(
  {
    userId: { type: Number, required: true, index: true },
    bankId: Number,
    bank: { bankName: String, bankAccount: String, fullName: String, ifsc: String, phoneNumber: String },
    amountPaise: { type: Number, required: true },
    transactionNumber: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    remark: String,
    processedAt: Date,
  },
  { timestamps: true, id: false }
);
autoIncrement(schema, 'withdrawal');

module.exports = mongoose.model('Withdrawal', schema);
