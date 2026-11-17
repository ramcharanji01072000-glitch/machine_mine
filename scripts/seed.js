// Seeds sample products and app info. Safe to re-run: skips if products already exist.
// Usage: npm run seed
const mongoose = require('mongoose');
const db = require('../src/db');
const { ensureAdmin } = require('../src/server');
const { Product, Setting } = require('../src/models');

const SAMPLE = [
  { name: 'Mini Miner', type: 'Normal', price: 500, days: 30, total: 900 },
  { name: 'Standard Miner', type: 'Normal', price: 2000, days: 45, total: 4000 },
  { name: 'Pro Miner', type: 'Normal', price: 5000, days: 60, total: 11000 },
  { name: 'Welfare Starter', type: 'Welfare', price: 100, days: 7, total: 140, limit: 1 },
  { name: 'Welfare Plus', type: 'Welfare', price: 300, days: 15, total: 450, limit: 2 },
];

(async () => {
  await db.connect();
  await ensureAdmin();
  const s = await Setting.get();
  if (!s.aboutUs) {
    s.aboutUs = 'MachineMine - buy mining machines and collect earnings every hour.';
    await s.save();
  }
  if (await Product.exists({})) {
    console.log('Products already exist - skipping product seed.');
  } else {
    for (const [i, p] of SAMPLE.entries()) {
      await Product.create({
        name: p.name,
        type: p.type,
        pricePaise: p.price * 100,
        totalReturnPaise: p.total * 100,
        durationDays: p.days,
        purchaseLimit: p.limit || 0,
        sortOrder: i,
      });
    }
    console.log(`Created ${SAMPLE.length} sample products (add images from the admin panel).`);
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
