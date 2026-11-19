const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const config = require('./config');
const { fail } = require('./utils/respond');
const { Setting } = require('./models');

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// CSP off: admin pages use the Bootstrap CDN. CORP cross-origin: Flutter web loads /uploads images.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
if (process.env.NODE_ENV !== 'test') app.use(morgan(config.isProd ? 'combined' : 'dev'));
// Keep the raw body: payment webhooks are verified by HMAC over the exact bytes received.
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', index: false }));

// ---- Health check (for Render / uptime monitors) ----
// 200 when the server and MongoDB are reachable, 503 otherwise. No auth, never cached.
const { version } = require('../package.json');
app.get('/health', async (req, res) => {
  const started = Date.now();
  let db = 'down';
  try {
    if (mongoose.connection.readyState === 1) {
      await Promise.race([
        mongoose.connection.db.admin().ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      db = 'up';
    }
  } catch (e) {
    db = 'down';
  }
  const healthy = db === 'up';
  res.set('Cache-Control', 'no-store');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'error',
    db,
    uptime: Math.round(process.uptime()),
    version,
    time: new Date().toISOString(),
    responseMs: Date.now() - started,
  });
});

// ---- Mobile app API (paths match machinemine/lib/util/app_constant.dart) ----
const { pr, wf } = require('./routes/api/products');
const { cs, nt, dt, am, rf } = require('./routes/api/misc');
app.use('/api/v1/auth', require('./routes/api/auth'));
app.use('/api/v1/pr', pr);
app.use('/api/v1/wf', wf);
app.use('/api/v1/bn', require('./routes/api/bank'));
app.use('/api/v1/cs', cs);
app.use('/api/v1/nt', nt);
app.use('/api/v1/dt', dt);
app.use('/api/v1/am', am);
app.use('/api/v1/rf', rf);
app.use('/api/v1/pay', require('./routes/api/payments'));
app.use('/api', (req, res) => fail(res, 'Route not found', 404));

// Invite links shared from the app look like {baseUrl}/signup/{code}
app.get('/signup/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (config.webAppUrl) return res.redirect(`${config.webAppUrl}/signup/${code}`);
    const s = await Setting.get();
    res.render('invite', { code, androidLink: s.androidLink, iosLink: s.iosLink });
  } catch (e) {
    next(e);
  }
});

// Public Terms & Conditions page (text is managed in Admin → Settings).
app.get('/terms', async (req, res, next) => {
  try {
    const s = await Setting.get();
    res.render('terms', { terms: s.terms || '', updatedAt: s.updatedAt });
  } catch (e) {
    next(e);
  }
});

// ---- Admin panel ----
app.use('/admin', require('./routes/admin'));
app.get('/', (req, res) => res.redirect('/admin'));

// ---- Errors ----
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return fail(res, 'Invalid JSON body');
  if (err.code === 'LIMIT_FILE_SIZE') err = Object.assign(new Error('Image must be under 5 MB'), { code: 400 });
  if (err.code === 11000) err = Object.assign(new Error('Duplicate value: that record already exists'), { code: 400 });
  const code = Number.isInteger(err.code) && err.code >= 400 && err.code < 600 ? err.code : 500;
  if (code === 500) console.error(err);
  const message = code === 500 ? 'Internal Server Error' : err.message;
  if (req.originalUrl.startsWith('/admin') && req.accepts('html')) {
    return res.status(code).send(`<p>${message.replace(/</g, '&lt;')}</p><p><a href="javascript:history.back()">Go back</a></p>`);
  }
  return fail(res, message, code);
});

module.exports = app;
