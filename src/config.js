require('dotenv').config();
const crypto = require('crypto');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

function secret(name) {
  if (process.env[name]) return process.env[name];
  if (isProd) throw new Error(`${name} must be set in production`);
  console.warn(`[config] ${name} not set - using a random secret (sessions reset on restart)`);
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/machinemine',
  jwtSecret: secret('JWT_SECRET'),
  adminJwtSecret: secret('ADMIN_JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  webAppUrl: (process.env.WEB_APP_URL || '').replace(/\/$/, ''),
  uploadDir: path.join(__dirname, '..', 'uploads'),
};
