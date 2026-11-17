const mongoose = require('mongoose');

const Counter = mongoose.model('Counter', new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }));

async function nextId(name) {
  const c = await Counter.findByIdAndUpdate(name, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return c.seq;
}

// Adds a numeric, auto-incrementing `id` (the Flutter app parses ids as int).
function autoIncrement(schema, name) {
  schema.add({ id: { type: Number, unique: true, index: true } });
  schema.pre('save', async function () {
    if (this.isNew && this.id == null) this.id = await nextId(name);
  });
}

module.exports = { Counter, nextId, autoIncrement };
