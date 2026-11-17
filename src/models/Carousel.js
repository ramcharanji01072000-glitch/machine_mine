const mongoose = require('mongoose');

module.exports = mongoose.model(
  'Carousel',
  new mongoose.Schema(
    {
      image: { type: String, required: true },
      caption: String,
      order: { type: Number, default: 0 },
      status: { type: Boolean, default: true },
      routes: String,
    },
    { timestamps: true }
  )
);
