const mongoose = require('mongoose');
const { autoIncrement } = require('./Counter');

// In-app announcements: offers, notices and alerts, shown on the app's Home screen.
const TYPES = ['offer', 'notice', 'alert'];
// Where the optional button takes the user in the app ('link' copies ctaLink).
const ACTIONS = ['none', 'products', 'welfare', 'machines', 'withdraw', 'recharge', 'invite', 'team', 'link'];

const schema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 80 },
    message: { type: String, trim: true, maxlength: 1000, default: '' },
    type: { type: String, enum: TYPES, default: 'notice' },
    image: String, // optional /uploads path
    ctaLabel: { type: String, trim: true, maxlength: 30 },
    ctaAction: { type: String, enum: ACTIONS, default: 'none' },
    ctaLink: { type: String, trim: true, maxlength: 500 },
    startsAt: Date, // null = immediately
    endsAt: Date, // null = no end
    popup: { type: Boolean, default: true }, // show as a pop-up banner (with close button) when the app launches
    popupOnce: { type: Boolean, default: false }, // false = every app launch, true = only the first time per user
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, id: false }
);
autoIncrement(schema, 'notice');

/** Mongo filter for notices visible right now. */
schema.statics.liveFilter = (now = new Date()) => ({
  isActive: true,
  $and: [
    { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
    { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gt: now } }] },
  ],
});

/** 'live' | 'scheduled' | 'expired' | 'off' */
schema.methods.state = function (now = new Date()) {
  if (!this.isActive) return 'off';
  if (this.startsAt && this.startsAt > now) return 'scheduled';
  if (this.endsAt && this.endsAt <= now) return 'expired';
  return 'live';
};

const Notice = mongoose.model('Notice', schema);
Notice.TYPES = TYPES;
Notice.ACTIONS = ACTIONS;
module.exports = Notice;
