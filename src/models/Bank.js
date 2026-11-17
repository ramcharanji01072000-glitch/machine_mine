const mongoose = require('mongoose');
const { autoIncrement } = require('./Counter');

const schema = new mongoose.Schema(
  {
    userId: { type: Number, required: true, unique: true },
    phoneNumber: String,
    bankName: { type: String, required: true },
    bankAccount: { type: String, required: true },
    fullName: { type: String, required: true },
    ifsc: { type: String, required: true, uppercase: true },
  },
  { timestamps: true, id: false }
);
autoIncrement(schema, 'bank');

module.exports = mongoose.model('Bank', schema);
