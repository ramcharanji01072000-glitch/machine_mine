const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { User, Setting } = require('../../models');
const { ok, fail, wrap } = require('../../utils/respond');
const { signUserToken, requireUser } = require('../../middleware/auth');
const { credit } = require('../../services/wallet');
const serialize = require('../../utils/serialize');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => fail(res, 'Too many attempts, please try again later', 429),
});

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const CODE_RE = /^[A-Z0-9]{4,12}$/;

function randomInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(6), (b) => chars[b % chars.length]).join('');
}

// GET /check-invite/:code -> status true + the code if it is still free (app loops until free)
router.get(
  '/check-invite/:code',
  wrap(async (req, res) => {
    const code = str(req.params.code).toUpperCase();
    if (!CODE_RE.test(code)) return fail(res, 'Invalid code format');
    const taken = await User.exists({ inviteCode: code });
    return taken ? fail(res, 'Code already in use') : ok(res, 'Code available', code);
  })
);

router.post(
  '/register',
  limiter,
  wrap(async (req, res) => {
    const b = req.body || {};
    const name = str(b.name);
    const mobile = str(b.mobile).replace(/\s+/g, '');
    const password = str(b.password);
    const withdrawalPassword = str(b.withdrawal_password);
    const referredBy = str(b.referred_by).toUpperCase();

    if (!name) return fail(res, 'Name is required');
    if (!/^\+?\d{7,15}$/.test(mobile)) return fail(res, 'Enter a valid mobile number');
    if (password.length < 6) return fail(res, 'Password must be at least 6 characters');
    if (withdrawalPassword.length < 6) return fail(res, 'Withdraw password must be at least 6 characters');
    if (await User.exists({ mobile })) return fail(res, 'Mobile number already registered');

    let referrer = null;
    if (referredBy) {
      referrer = await User.findOne({ inviteCode: referredBy });
      if (!referrer) return fail(res, 'Invalid refer code');
    }

    let inviteCode = str(b.invite_code).toUpperCase();
    if (!CODE_RE.test(inviteCode) || (await User.exists({ inviteCode }))) {
      do inviteCode = randomInviteCode();
      while (await User.exists({ inviteCode }));
    }

    const user = await User.create({
      name,
      email: str(b.email) || undefined,
      mobile,
      password: await bcrypt.hash(password, 10),
      withdrawalPassword: await bcrypt.hash(withdrawalPassword, 10),
      inviteCode,
      referredBy: referrer ? referrer.inviteCode : null,
      referrerId: referrer ? referrer.id : null,
      question: str(b.question) || undefined,
      answer: str(b.answer) ? await bcrypt.hash(str(b.answer).toLowerCase(), 10) : undefined,
      termsAcceptedAt: b.accept_terms === true || b.accept_terms === 'true' ? new Date() : undefined,
    });

    const settings = await Setting.get();
    if (settings.signupBonusPaise > 0) await credit(user.id, settings.signupBonusPaise, 'Bonus', { note: 'Signup bonus' });

    return ok(res, 'Registration successful, please login', serialize.user(user), 201);
  })
);

router.post(
  '/login',
  limiter,
  wrap(async (req, res) => {
    const mobile = str(req.body?.mobile).replace(/\s+/g, '');
    const password = str(req.body?.password);
    if (!mobile || !password) return fail(res, 'Mobile and password are required');

    const user = await User.findOne({ mobile });
    // 400 (not 401) so the app shows the message instead of force-logging out
    if (!user || !(await bcrypt.compare(password, user.password))) return fail(res, 'Invalid mobile number or password');
    if (user.isBlocked) return fail(res, 'Your account has been blocked, contact support');

    user.lastLoginAt = new Date();
    await user.save();
    return ok(res, 'Login successful', serialize.user(user, signUserToken(user)));
  })
);

router.get('/verify-token', requireUser, (req, res) => ok(res, 'Token valid', serialize.user(req.user)));

// Body: { currentPassword, newPassword, mobile }  (mobile ignored; the token identifies the user)
router.post(
  '/update-password',
  requireUser,
  limiter,
  wrap(async (req, res) => {
    const current = str(req.body?.currentPassword);
    const next = str(req.body?.newPassword);
    if (next.length < 6) return fail(res, 'New password must be at least 6 characters');
    if (!(await bcrypt.compare(current, req.user.password))) return fail(res, 'Current password is incorrect');
    req.user.password = await bcrypt.hash(next, 10);
    await req.user.save();
    return ok(res, 'Password updated successfully');
  })
);

// Body: { currentWithdrawalPassword, newWithdrawalPassword, mobile }
router.post(
  '/update-withdrawal-password',
  requireUser,
  limiter,
  wrap(async (req, res) => {
    const current = str(req.body?.currentWithdrawalPassword);
    const next = str(req.body?.newWithdrawalPassword);
    if (next.length < 6) return fail(res, 'New withdraw password must be at least 6 characters');
    if (!(await bcrypt.compare(current, req.user.withdrawalPassword)))
      return fail(res, 'Current withdraw password is incorrect');
    req.user.withdrawalPassword = await bcrypt.hash(next, 10);
    await req.user.save();
    return ok(res, 'Withdraw password updated successfully');
  })
);

module.exports = router;
