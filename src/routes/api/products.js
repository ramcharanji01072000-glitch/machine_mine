const express = require('express');
const { Product, Purchase } = require('../../models');
const { ok, fail, wrap } = require('../../utils/respond');
const { requireUser } = require('../../middleware/auth');
const { debit, credit, payReferralCommissions } = require('../../services/wallet');
const serialize = require('../../utils/serialize');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const listByType = (type) =>
  wrap(async (req, res) => {
    const products = await Product.find({ type, isActive: true }).sort({ sortOrder: 1, id: 1 });
    return ok(res, 'Products fetched', products.map(serialize.product));
  });

// Mounted at /api/v1/pr
const pr = express.Router();

pr.get('/', listByType('Normal'));

// Any product (normal or welfare, active or not) - My Products needs details of past purchases.
pr.get(
  '/get-product/:id',
  wrap(async (req, res) => {
    const product = await Product.findOne({ id: Number(req.params.id) });
    if (!product) return fail(res, 'Product not found', 404);
    return ok(res, 'Product fetched', serialize.product(product));
  })
);

// Body: { productId, productType, validDays, userId } - only productId is trusted.
pr.post(
  '/buy-product',
  requireUser,
  wrap(async (req, res) => {
    const user = req.user;
    const product = await Product.findOne({ id: Number(req.body?.productId), isActive: true });
    if (!product) return fail(res, 'Product not available', 404);

    if (product.purchaseLimit > 0) {
      const count = await Purchase.countDocuments({ userId: user.id, productId: product.id });
      if (count >= product.purchaseLimit) return fail(res, `Purchase limit reached for this product`);
    }

    const txn = await debit(user.id, product.pricePaise, 'Buy', { note: `Bought ${product.name}` });
    if (!txn) return fail(res, 'Insufficient Balance');

    const now = new Date();
    let purchase;
    try {
      purchase = await Purchase.create({
        userId: user.id,
        productId: product.id,
        productType: product.type,
        productName: product.name,
        pricePaise: product.pricePaise,
        totalReturnPaise: product.totalReturnPaise,
        durationDays: product.durationDays,
        lastClaimAt: now,
        expiresAt: new Date(now.getTime() + product.durationDays * DAY),
      });
    } catch (e) {
      await credit(user.id, product.pricePaise, 'WithdrawFailure', { note: `Refund: purchase of ${product.name} failed` });
      throw e;
    }
    txn.refId = purchase.id;
    await txn.save();

    payReferralCommissions(user, purchase).catch((e) => console.error('[referral]', e));
    return ok(res, 'Product purchased successfully', serialize.purchase(purchase));
  })
);

// GET /buy-product/:userId -> active purchases of the logged-in user (param ignored)
pr.get(
  '/buy-product/:userId?',
  requireUser,
  wrap(async (req, res) => {
    const purchases = await Purchase.find({
      userId: req.user.id,
      $expr: { $lt: ['$lastClaimAt', '$expiresAt'] }, // hide fully-claimed expired products
    }).sort({ id: -1 });
    return ok(res, 'Products fetched', purchases.map(serialize.purchase));
  })
);

// Claim. Body: { productId: <purchase id>, userId }
// Earnings are computed and credited HERE (as a 'Collect' transaction); the amount the
// app later posts to /am/add is ignored, so it cannot be tampered with.
pr.post(
  '/update-time',
  requireUser,
  wrap(async (req, res) => {
    const purchase = await Purchase.findOne({ id: Number(req.body?.productId), userId: req.user.id });
    if (!purchase) return fail(res, 'Product not found', 404);

    const now = new Date();
    const start = purchase.lastClaimAt;
    if (start >= purchase.expiresAt) return fail(res, 'This product has expired');
    const expired = now >= purchase.expiresAt;
    if (!expired && now - start < HOUR) return fail(res, 'claim is open after every 1 hour');

    const end = expired ? purchase.expiresAt : now;
    const amount = expired
      ? purchase.totalReturnPaise - purchase.claimedPaise // final claim pays the exact remainder
      : Math.floor((purchase.totalReturnPaise * (end - start)) / (purchase.durationDays * DAY));

    // Conditional update on the old timestamp: a concurrent double-tap can only win once.
    const updated = await Purchase.findOneAndUpdate(
      { _id: purchase._id, lastClaimAt: start },
      { $set: { lastClaimAt: end }, $inc: { claimedPaise: Math.max(amount, 0) } },
      { new: true }
    );
    if (!updated) return fail(res, 'Claim already processed', 409);

    if (amount > 0) {
      await credit(req.user.id, amount, 'Collect', { note: `Earnings from ${purchase.productName}`, refId: purchase.id });
    }
    return ok(res, amount > 0 ? 'Claimed successfully' : 'Nothing to claim yet', {
      ...serialize.purchase(updated),
      claimedAmount: (Math.max(amount, 0) / 100).toFixed(2),
    });
  })
);

// Mounted at /api/v1/wf
const wf = express.Router();
wf.get('/', listByType('Welfare'));

module.exports = { pr, wf };
