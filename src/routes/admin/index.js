const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { User, Product, Purchase, Transaction, Bank, Withdrawal, Carousel, Setting, Admin } = require('../../models');
const { requireAdmin, setAdminCookie, ADMIN_COOKIE } = require('../../middleware/auth');
const { upload, publicPath, removeUpload } = require('../../middleware/upload');
const { credit, debit } = require('../../services/wallet');
const { toPaise, fmt } = require('../../utils/money');
const { wrap, HttpError } = require('../../utils/respond');

const PAGE_SIZE = 25;
const TIMEZONE = process.env.ADMIN_TIMEZONE || 'Asia/Kolkata';
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Redirect with a flash message shown by the layout.
function go(res, url, msg, isError = false) {
  const sep = url.includes('?') ? '&' : '?';
  return res.redirect(`${url}${sep}${isError ? 'err' : 'ok'}=${encodeURIComponent(msg)}`);
}

function paging(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  return { page, skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE };
}

async function usersById(ids) {
  const users = await User.find({ id: { $in: [...new Set(ids)] } }, { id: 1, name: 1, mobile: 1 });
  return Object.fromEntries(users.map((u) => [u.id, u]));
}

router.use((req, res, next) => {
  res.locals.fmt = fmt;
  res.locals.dt = (d) =>
    d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: TIMEZONE }) : '-';
  res.locals.modeClass = (m) =>
    ({ Recharge: 'success', Collect: 'primary', Referral: 'info', Bonus: 'info', Buy: 'warning', Withdraw: 'danger', Deduct: 'danger', WithdrawFailure: 'secondary' })[m] || 'secondary';
  res.locals.flash = { ok: str(req.query.ok), err: str(req.query.err) };
  res.locals.path = req.path;
  res.locals.query = req.query;
  res.locals.pageSize = PAGE_SIZE;
  next();
});

// ---------- Auth ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });

router.get('/login', (req, res) => res.render('admin/login', { error: '' }));

router.post(
  '/login',
  loginLimiter,
  wrap(async (req, res) => {
    const admin = await Admin.findOne({ username: str(req.body.username) });
    if (!admin || !(await bcrypt.compare(str(req.body.password), admin.password))) {
      return res.status(400).render('admin/login', { error: 'Invalid username or password' });
    }
    setAdminCookie(res, admin);
    res.redirect('/admin');
  })
);

router.post('/logout', (req, res) => {
  res.clearCookie(ADMIN_COOKIE);
  res.redirect('/admin/login');
});

router.use(requireAdmin);

// ---------- Dashboard ----------
router.get(
  '/',
  wrap(async (req, res) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sumBy = async (match) => {
      const [r] = await Transaction.aggregate([{ $match: match }, { $group: { _id: null, t: { $sum: '$amountPaise' } } }]);
      return r ? r.t : 0;
    };
    const [users, usersToday, balanceAgg, pending, pendingAgg, activePurchases] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: startOfDay } }),
      User.aggregate([{ $group: { _id: null, t: { $sum: '$balancePaise' } } }]),
      Withdrawal.countDocuments({ status: 'pending' }),
      Withdrawal.aggregate([{ $match: { status: 'pending' } }, { $group: { _id: null, t: { $sum: '$amountPaise' } } }]),
      Purchase.countDocuments({ expiresAt: { $gt: new Date() } }),
    ]);
    const [rechargeTotal, rechargeToday, buyTotal, collectTotal, paidOutAgg] = await Promise.all([
      sumBy({ mode: 'Recharge' }),
      sumBy({ mode: 'Recharge', createdAt: { $gte: startOfDay } }),
      sumBy({ mode: 'Buy' }),
      sumBy({ mode: 'Collect' }),
      Withdrawal.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, t: { $sum: '$amountPaise' } } }]),
    ]);
    const recent = await Transaction.find().sort({ id: -1 }).limit(10);
    res.render('admin/dashboard', {
      stats: {
        users,
        usersToday,
        walletTotal: balanceAgg[0]?.t || 0,
        pending,
        pendingAmount: pendingAgg[0]?.t || 0,
        activePurchases,
        rechargeTotal,
        rechargeToday,
        buyTotal,
        collectTotal,
        paidOut: paidOutAgg[0]?.t || 0,
      },
      recent,
      userMap: await usersById(recent.map((t) => t.userId)),
    });
  })
);

// ---------- Users ----------
router.get(
  '/users',
  wrap(async (req, res) => {
    const { page, skip, limit } = paging(req);
    const q = str(req.query.q);
    const filter = {};
    if (q) {
      const re = new RegExp(escapeRe(q), 'i');
      filter.$or = [{ name: re }, { mobile: re }, { inviteCode: re }];
      if (/^\d+$/.test(q)) filter.$or.push({ id: Number(q) });
    }
    if (req.query.blocked === '1') filter.isBlocked = true;
    const [users, total] = await Promise.all([
      User.find(filter).sort({ id: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    res.render('admin/users', { users, total, page, q });
  })
);

async function loadUser(req) {
  const user = await User.findOne({ id: Number(req.params.id) });
  if (!user) throw new HttpError('User not found', 404);
  return user;
}

router.get(
  '/users/:id',
  wrap(async (req, res) => {
    const user = await loadUser(req);
    const [bank, purchases, transactions, withdrawals, referrer, directTeam] = await Promise.all([
      Bank.findOne({ userId: user.id }),
      Purchase.find({ userId: user.id }).sort({ id: -1 }).limit(50),
      Transaction.find({ userId: user.id }).sort({ id: -1 }).limit(50),
      Withdrawal.find({ userId: user.id }).sort({ id: -1 }).limit(20),
      user.referrerId ? User.findOne({ id: user.referrerId }) : null,
      User.find({ referrerId: user.id }).sort({ id: -1 }).limit(100),
    ]);
    res.render('admin/user', { user, bank, purchases, transactions, withdrawals, referrer, directTeam });
  })
);

router.post(
  '/users/:id/wallet',
  wrap(async (req, res) => {
    const user = await loadUser(req);
    const back = `/admin/users/${user.id}`;
    const amount = toPaise(req.body.amount);
    const action = str(req.body.action);
    const note = str(req.body.note) || `By admin ${req.admin.username}`;
    if (!Number.isInteger(amount) || amount <= 0) return go(res, back, 'Enter a valid amount', true);
    if (action === 'Recharge' || action === 'Bonus') {
      await credit(user.id, amount, action, { note });
      return go(res, back, `${action} of ${fmt(amount)} added`);
    }
    if (action === 'Deduct') {
      const t = await debit(user.id, amount, 'Deduct', { note });
      return t ? go(res, back, `Deducted ${fmt(amount)}`) : go(res, back, 'User balance is too low', true);
    }
    return go(res, back, 'Unknown action', true);
  })
);

router.post(
  '/users/:id/edit',
  wrap(async (req, res) => {
    const user = await loadUser(req);
    const back = `/admin/users/${user.id}`;
    const name = str(req.body.name);
    const mobile = str(req.body.mobile).replace(/\s+/g, '');
    if (!name || !/^\+?\d{7,15}$/.test(mobile)) return go(res, back, 'Valid name and mobile required', true);
    if (mobile !== user.mobile && (await User.exists({ mobile }))) return go(res, back, 'Mobile already in use', true);
    user.name = name;
    user.mobile = mobile;
    user.email = str(req.body.email) || undefined;
    await user.save();
    go(res, back, 'User updated');
  })
);

router.post(
  '/users/:id/block',
  wrap(async (req, res) => {
    const user = await loadUser(req);
    user.isBlocked = !user.isBlocked;
    if (user.isBlocked) user.tokenVersion += 1; // log out all sessions
    await user.save();
    go(res, `/admin/users/${user.id}`, user.isBlocked ? 'User blocked' : 'User unblocked');
  })
);

router.post(
  '/users/:id/password',
  wrap(async (req, res) => {
    const user = await loadUser(req);
    const back = `/admin/users/${user.id}`;
    const pwd = str(req.body.password);
    const field = req.body.which === 'withdraw' ? 'withdrawalPassword' : 'password';
    if (pwd.length < 6) return go(res, back, 'Password must be at least 6 characters', true);
    user[field] = await bcrypt.hash(pwd, 10);
    if (field === 'password') user.tokenVersion += 1;
    await user.save();
    go(res, back, field === 'password' ? 'Login password reset' : 'Withdraw password reset');
  })
);

// ---------- Products ----------
router.get(
  '/products',
  wrap(async (req, res) => {
    const filter = {};
    if (req.query.type === 'Normal' || req.query.type === 'Welfare') filter.type = req.query.type;
    const products = await Product.find(filter).sort({ type: 1, sortOrder: 1, id: 1 });
    const counts = await Purchase.aggregate([{ $group: { _id: '$productId', n: { $sum: 1 } } }]);
    res.render('admin/products', { products, sold: Object.fromEntries(counts.map((c) => [c._id, c.n])) });
  })
);

router.get('/products/new', (req, res) => res.render('admin/product-form', { product: null }));

router.get(
  '/products/:id/edit',
  wrap(async (req, res) => {
    const product = await Product.findOne({ id: Number(req.params.id) });
    if (!product) throw new HttpError('Product not found', 404);
    res.render('admin/product-form', { product });
  })
);

function productFields(body) {
  const data = {
    name: str(body.name),
    type: body.type === 'Welfare' ? 'Welfare' : 'Normal',
    pricePaise: toPaise(body.price),
    totalReturnPaise: toPaise(body.totalReturn),
    durationDays: parseInt(body.durationDays, 10),
    purchaseLimit: Math.max(0, parseInt(body.purchaseLimit, 10) || 0),
    sortOrder: parseInt(body.sortOrder, 10) || 0,
    isActive: body.isActive === 'on',
  };
  if (!data.name) return [null, 'Name is required'];
  if (!(data.pricePaise > 0)) return [null, 'Price must be greater than 0'];
  if (!(data.totalReturnPaise >= 0)) return [null, 'Total return is invalid'];
  if (!(data.durationDays >= 1)) return [null, 'Duration must be at least 1 day'];
  return [data, null];
}

router.post(
  '/products',
  upload.single('image'),
  wrap(async (req, res) => {
    const [data, error] = productFields(req.body);
    if (error) {
      if (req.file) removeUpload(publicPath(req.file));
      return go(res, '/admin/products/new', error, true);
    }
    await Product.create({ ...data, image: publicPath(req.file) });
    go(res, '/admin/products', 'Product created');
  })
);

router.post(
  '/products/:id',
  upload.single('image'),
  wrap(async (req, res) => {
    const product = await Product.findOne({ id: Number(req.params.id) });
    if (!product) throw new HttpError('Product not found', 404);
    const [data, error] = productFields(req.body);
    if (error) {
      if (req.file) removeUpload(publicPath(req.file));
      return go(res, `/admin/products/${product.id}/edit`, error, true);
    }
    if (req.file) {
      removeUpload(product.image);
      data.image = publicPath(req.file);
    }
    Object.assign(product, data);
    await product.save();
    go(res, '/admin/products', 'Product updated (existing purchases keep their original terms)');
  })
);

router.post(
  '/products/:id/delete',
  wrap(async (req, res) => {
    const product = await Product.findOne({ id: Number(req.params.id) });
    if (!product) throw new HttpError('Product not found', 404);
    if (await Purchase.exists({ productId: product.id })) {
      product.isActive = false;
      await product.save();
      return go(res, '/admin/products', 'Product has purchases, so it was deactivated instead of deleted');
    }
    removeUpload(product.image);
    await product.deleteOne();
    go(res, '/admin/products', 'Product deleted');
  })
);

// ---------- Purchases ----------
router.get(
  '/purchases',
  wrap(async (req, res) => {
    const { page, skip, limit } = paging(req);
    const filter = {};
    if (/^\d+$/.test(str(req.query.userId))) filter.userId = Number(req.query.userId);
    if (req.query.state === 'active') filter.expiresAt = { $gt: new Date() };
    if (req.query.state === 'expired') filter.expiresAt = { $lte: new Date() };
    const [purchases, total] = await Promise.all([
      Purchase.find(filter).sort({ id: -1 }).skip(skip).limit(limit),
      Purchase.countDocuments(filter),
    ]);
    res.render('admin/purchases', { purchases, total, page, userMap: await usersById(purchases.map((p) => p.userId)) });
  })
);

// ---------- Withdrawals ----------
router.get(
  '/withdrawals',
  wrap(async (req, res) => {
    const { page, skip, limit } = paging(req);
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    const filter = { status };
    const [withdrawals, total] = await Promise.all([
      Withdrawal.find(filter).sort({ id: status === 'pending' ? 1 : -1 }).skip(skip).limit(limit),
      Withdrawal.countDocuments(filter),
    ]);
    res.render('admin/withdrawals', {
      withdrawals,
      total,
      page,
      status,
      userMap: await usersById(withdrawals.map((w) => w.userId)),
    });
  })
);

router.post(
  '/withdrawals/:id/:action(approve|reject)',
  wrap(async (req, res) => {
    const approve = req.params.action === 'approve';
    const back = str(req.body.back).startsWith('/admin/') ? str(req.body.back) : '/admin/withdrawals';
    // Only a pending request can move, and only once (atomic status check).
    const w = await Withdrawal.findOneAndUpdate(
      { id: Number(req.params.id), status: 'pending' },
      { $set: { status: approve ? 'approved' : 'rejected', remark: str(req.body.remark), processedAt: new Date() } },
      { new: true }
    );
    if (!w) return go(res, back, 'Withdrawal not found or already processed', true);
    if (!approve) {
      await credit(w.userId, w.amountPaise, 'WithdrawFailure', {
        note: `Withdraw #${w.id} rejected${w.remark ? ': ' + w.remark : ''} - refunded`,
        refId: w.id,
      });
    }
    go(res, back, approve ? `Withdrawal #${w.id} approved` : `Withdrawal #${w.id} rejected and refunded`);
  })
);

// ---------- Transactions ----------
router.get(
  '/transactions',
  wrap(async (req, res) => {
    const { page, skip, limit } = paging(req);
    const filter = {};
    if (Transaction.MODES.includes(req.query.mode)) filter.mode = req.query.mode;
    if (/^\d+$/.test(str(req.query.userId))) filter.userId = Number(req.query.userId);
    const [transactions, total] = await Promise.all([
      Transaction.find(filter).sort({ id: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments(filter),
    ]);
    res.render('admin/transactions', {
      transactions,
      total,
      page,
      modes: Transaction.MODES,
      userMap: await usersById(transactions.map((t) => t.userId)),
    });
  })
);

// ---------- Carousel ----------
router.get(
  '/carousel',
  wrap(async (req, res) => {
    res.render('admin/carousel', { slides: await Carousel.find().sort({ order: 1, createdAt: -1 }) });
  })
);

router.post(
  '/carousel',
  upload.single('image'),
  wrap(async (req, res) => {
    if (!req.file) return go(res, '/admin/carousel', 'Choose an image (jpg, png, webp or gif)', true);
    await Carousel.create({
      image: publicPath(req.file),
      caption: str(req.body.caption),
      routes: str(req.body.routes),
      order: parseInt(req.body.order, 10) || 0,
      status: req.body.status === 'on',
    });
    go(res, '/admin/carousel', 'Slide added');
  })
);

async function loadSlide(req) {
  if (!/^[a-f0-9]{24}$/.test(req.params.id)) throw new HttpError('Slide not found', 404);
  const slide = await Carousel.findById(req.params.id);
  if (!slide) throw new HttpError('Slide not found', 404);
  return slide;
}

router.post(
  '/carousel/:id',
  upload.single('image'),
  wrap(async (req, res) => {
    const slide = await loadSlide(req);
    slide.caption = str(req.body.caption);
    slide.routes = str(req.body.routes);
    slide.order = parseInt(req.body.order, 10) || 0;
    slide.status = req.body.status === 'on';
    if (req.file) {
      removeUpload(slide.image);
      slide.image = publicPath(req.file);
    }
    await slide.save();
    go(res, '/admin/carousel', 'Slide updated');
  })
);

router.post(
  '/carousel/:id/delete',
  wrap(async (req, res) => {
    const slide = await loadSlide(req);
    removeUpload(slide.image);
    await slide.deleteOne();
    go(res, '/admin/carousel', 'Slide deleted');
  })
);

// ---------- Settings ----------
router.get(
  '/settings',
  wrap(async (req, res) => res.render('admin/settings', { s: await Setting.get() }))
);

router.post(
  '/settings',
  upload.single('logo'),
  wrap(async (req, res) => {
    const pct = (v) => Math.min(100, Math.max(0, Number(v) || 0));
    const money = (v) => Math.max(0, toPaise(v) || 0);
    const s = await Setting.get();
    if (req.file) {
      removeUpload(s.logo);
      s.logo = publicPath(req.file);
    } else if (req.body.removeLogo === 'on') {
      removeUpload(s.logo);
      s.logo = undefined;
    }
    Object.assign(s, {
      aboutUs: str(req.body.aboutUs),
      androidLink: str(req.body.androidLink),
      iosLink: str(req.body.iosLink),
      telegram: str(req.body.telegram),
      referralLevel1: pct(req.body.referralLevel1),
      referralLevel2: pct(req.body.referralLevel2),
      referralLevel3: pct(req.body.referralLevel3),
      minWithdrawPaise: money(req.body.minWithdraw),
      signupBonusPaise: money(req.body.signupBonus),
    });
    await s.save();
    go(res, '/admin/settings', 'Settings saved');
  })
);

router.post(
  '/account/password',
  wrap(async (req, res) => {
    const admin = req.admin;
    if (!(await bcrypt.compare(str(req.body.current), admin.password)))
      return go(res, '/admin/settings', 'Current admin password is incorrect', true);
    const next = str(req.body.next);
    if (next.length < 8) return go(res, '/admin/settings', 'New password must be at least 8 characters', true);
    admin.password = await bcrypt.hash(next, 10);
    admin.tokenVersion += 1;
    await admin.save();
    setAdminCookie(res, admin);
    go(res, '/admin/settings', 'Admin password changed');
  })
);

module.exports = router;
