const mongoose = require('mongoose');

module.exports = mongoose.model(
  'Admin',
  new mongoose.Schema(
    {
      username: { type: String, required: true, unique: true, trim: true },
      password: { type: String, required: true },
      tokenVersion: { type: Number, default: 0 },
    },
    { timestamps: true }
  )
);
