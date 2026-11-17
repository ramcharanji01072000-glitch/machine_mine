const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');
const app = require('./app');
const { Admin, Setting } = require('./models');

async function ensureAdmin() {
  if (await Admin.exists({})) return;
  if (!config.adminPassword) {
    console.warn('[admin] No admin exists. Set ADMIN_USERNAME / ADMIN_PASSWORD in .env and restart.');
    return;
  }
  await Admin.create({ username: config.adminUsername, password: await bcrypt.hash(config.adminPassword, 10) });
  console.log(`[admin] created admin user "${config.adminUsername}"`);
}

async function start() {
  await db.connect();
  await ensureAdmin();
  await Setting.get();
  app.listen(config.port, () => {
    console.log(`[server] API   http://localhost:${config.port}/api/v1`);
    console.log(`[server] Admin http://localhost:${config.port}/admin`);
  });
}

if (require.main === module) {
  start().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { start, ensureAdmin };
