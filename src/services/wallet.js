const { User, Transaction, Setting } = require('../models');

// Balance changes use a single atomic $inc so concurrent requests can't double-spend.
// Every change writes a Transaction row (the app's "Financial Details" list).

async function credit(userId, amountPaise, mode, extra = {}) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error('Invalid credit amount');
  const before = await User.findOneAndUpdate({ id: userId }, { $inc: { balancePaise: amountPaise } }, { new: false });
  if (!before) throw new Error('User not found');
  return Transaction.create({
    userId,
    mode,
    amountPaise,
    previousPaise: before.balancePaise,
    updatedPaise: before.balancePaise + amountPaise,
    ...extra,
  });
}

// Returns null when the balance is insufficient.
async function debit(userId, amountPaise, mode, extra = {}) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error('Invalid debit amount');
  const before = await User.findOneAndUpdate(
    { id: userId, balancePaise: { $gte: amountPaise } },
    { $inc: { balancePaise: -amountPaise } },
    { new: false }
  );
  if (!before) return null;
  return Transaction.create({
    userId,
    mode,
    amountPaise,
    previousPaise: before.balancePaise,
    updatedPaise: before.balancePaise - amountPaise,
    ...extra,
  });
}

// Pays up to 3 levels of upline a % of the purchase price.
async function payReferralCommissions(buyer, purchase) {
  const settings = await Setting.get();
  const rates = [settings.referralLevel1, settings.referralLevel2, settings.referralLevel3];
  let uplineId = buyer.referrerId;
  for (let level = 1; level <= 3 && uplineId; level++) {
    const upline = await User.findOne({ id: uplineId }, { id: 1, referrerId: 1, isBlocked: 1 });
    if (!upline) break;
    const amount = Math.floor((purchase.pricePaise * (rates[level - 1] || 0)) / 100);
    if (amount > 0 && !upline.isBlocked) {
      await credit(upline.id, amount, 'Referral', {
        note: `Level ${level} commission from ${buyer.name} (${purchase.productName})`,
        refId: purchase.id,
        fromUserId: buyer.id,
        level,
      });
    }
    uplineId = upline.referrerId;
  }
}

module.exports = { credit, debit, payReferralCommissions };
