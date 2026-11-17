const jwt = require('jsonwebtoken');
const config = require('../config');
const { User, Admin } = require('../models');
const { fail } = require('../utils/respond');

function signUserToken(user) {
  return jwt.sign({ uid: user.id, v: user.tokenVersion }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

// App auth. 401 makes the Flutter app clear its session and return to login.
async function requireUser(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || token === 'null') return fail(res, 'Please login to continue', 401);
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await User.findOne({ id: payload.uid });
    if (!user || user.tokenVersion !== payload.v) return fail(res, 'Session expired, please login again', 401);
    if (user.isBlocked) return fail(res, 'Your account has been blocked', 401);
    req.user = user;
    next();
  } catch (e) {
    return fail(res, 'Session expired, please login again', 401);
  }
}

const ADMIN_COOKIE = 'mm_admin';

function signAdminToken(admin) {
  return jwt.sign({ aid: String(admin._id), v: admin.tokenVersion }, config.adminJwtSecret, { expiresIn: '12h' });
}

function setAdminCookie(res, admin) {
  res.cookie(ADMIN_COOKIE, signAdminToken(admin), {
    httpOnly: true,
    sameSite: 'strict', // blocks cross-site form posts (CSRF)
    secure: config.isProd,
    maxAge: 12 * 3600 * 1000,
  });
}

async function requireAdmin(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies[ADMIN_COOKIE] || '', config.adminJwtSecret);
    const admin = await Admin.findById(payload.aid);
    if (!admin || admin.tokenVersion !== payload.v) throw new Error('stale');
    req.admin = admin;
    res.locals.admin = admin;
    next();
  } catch (e) {
    res.clearCookie(ADMIN_COOKIE);
    return res.redirect('/admin/login');
  }
}

module.exports = { signUserToken, requireUser, setAdminCookie, requireAdmin, ADMIN_COOKIE };
