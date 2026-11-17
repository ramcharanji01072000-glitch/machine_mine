const mongoose = require('mongoose');
const { autoIncrement } = require('./Counter');

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    image: String, // relative path, e.g. /uploads/abc.jpg (the app prefixes baseUrl)
    type: { type: String, enum: ['Normal', 'Welfare'], default: 'Normal', index: true },
    pricePaise: { type: Number, required: true, min: 1 },
    totalReturnPaise: { type: Number, required: true, min: 0 },
    durationDays: { type: Number, required: true, min: 1 },
    purchaseLimit: { type: Number, default: 0 }, // per user, 0 = unlimited
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, id: false }
);
autoIncrement(schema, 'product');

module.exports = mongoose.model('Product', schema);
