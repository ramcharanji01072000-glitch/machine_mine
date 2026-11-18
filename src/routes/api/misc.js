// Smaller app endpoints: carousel, app info, amount history, referral summary.
const express = require('express');
const { Carousel, Setting, Transaction, User, Notice } = require('../../models');
const { ok, fail, wrap } = require('../../utils/respond');
const { requireUser } = require('../../middleware/auth');
const serialize = require('../../utils/serialize');

// /api/v1/cs
const cs = express.Router();
cs.get(
  '/all',
  wrap(async (req, res) => {
    const slides = await Carousel.find({ status: true }).sort({ order: 1, createdAt: -1 });
    return ok(res, 'Carousel fetched', slides.map(serialize.carousel));
  })
);

// /api/v1/nt — offers / notices / alerts that are live right now (public).
const nt = express.Router();
nt.get(
  '/active',
  wrap(async (req, res) => {
    const list = await Notice.find(Notice.liveFilter()).sort({ sortOrder: 1, createdAt: -1 }).limit(20);
    return ok(res, 'Notices fetched', list.map(serialize.notice));
  })
);

// /api/v1/dt
const dt = express.Router();
dt.get(
  '/app-info',
  wrap(async (req, res) => ok(res, 'App info fetched', serialize.appInfo(await Setting.get())))
);

// /api/v1/am
const am = express.Router();
am.use(requireUser);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /amount?userId=&mode=  (mode optional, case-insensitive). Oldest first: the app
// uses the LAST row's updatedAmount as the current balance.
am.get(
  '/amount',
  wrap(async (req, res) => {
    const filter = { userId: req.user.id };
    const mode = String(req.query.mode || '').trim();
    if (mode) filter.mode = new RegExp(`^${escapeRe(mode)}$`, 'i');
    const rows = await Transaction.find(filter).sort({ id: 1 });
    // The app calls `.last` on this list, which throws on an empty list - so report "no data" instead.
    if (!rows.length) return fail(res, 'No transactions found', 200);
    return ok(res, 'Transactions fetched', rows.map(serialize.transaction));
  })
);

// The app posts { mode: 'Collect', amount } right after a successful claim. The claim endpoint
// already credited the server-computed amount, so this is only acknowledged. Users can never
// add money themselves - recharges are credited from the admin panel.
am.post('/add', (req, res) => {
  if (req.body?.mode === 'Collect') return ok(res, 'Amount collected successfully');
  return fail(res, 'Recharge is processed by admin. Please contact support.');
});

// /api/v1/rf
const rf = express.Router();
rf.use(requireUser);

rf.get(
  '/referral-summary/:userId?',
  wrap(async (req, res) => {
    const levels = [];
    let parentIds = [req.user.id];
    for (let i = 0; i < 3; i++) {
      const members = parentIds.length
        ? await User.find({ referrerId: { $in: parentIds } }, { id: 1, name: 1, mobile: 1 }).sort({ id: -1 })
        : [];
      levels.push(members);
      parentIds = members.map((m) => m.id);
    }

    const earnings = await Transaction.aggregate([
      { $match: { userId: req.user.id, mode: 'Referral' } },
      { $group: { _id: '$level', total: { $sum: '$amountPaise' } } },
    ]);
    const byLevel = Object.fromEntries(earnings.map((e) => [e._id, e.total]));

    const body = { status: true, message: 'Referral summary fetched', data: {} };
    let total = 0;
    levels.forEach((members, i) => {
      const paise = byLevel[i + 1] || 0;
      total += paise;
      body.data[`level${i + 1}`] = {
        members: members.length,
        earnings: dbl(paise),
        list: members.map((m) => ({ id: m.id, name: m.name, mobileNumber: m.mobile })),
      };
    });
    body.data.totalEarnings = dbl(total);

    // Dart's model declares earnings as `double?`; JSON `150` would decode as int and throw,
    // so these values are written as `150.00` literals.
    const json = JSON.stringify(body).replace(/"__dbl__(-?\d+\.\d+)"/g, '$1');
    return res.type('application/json').send(json);
  })
);

const dbl = (paise) => `__dbl__${(paise / 100).toFixed(2)}`;

module.exports = { cs, nt, dt, am, rf };
