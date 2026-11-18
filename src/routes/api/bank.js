// Mounted at /api/v1/bn
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { Bank, Withdrawal, Setting } = require('../../models');
const { ok, fail, wrap } = require('../../utils/respond');
const { requireUser } = require('../../middleware/auth');
const { debit } = require('../../services/wallet');
const { toPaise, fmt } = require('../../utils/money');
const serialize = require('../../utils/serialize');

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

router.use(requireUser);

// Body: { userId, phone_number, bank_name, bank_account, full_name, ifsc } - creates or updates
router.post(
  '/bank-info',
  wrap(async (req, res) => {
    const b = req.body || {};
    const data = {
      phoneNumber: str(b.phone_number),
      bankName: str(b.bank_name),
      bankAccount: str(b.bank_account).replace(/\s+/g, ''),
      fullName: str(b.full_name),
      ifsc: str(b.ifsc).toUpperCase(),
    };
    if (!data.bankName || !data.bankAccount || !data.fullName || !data.ifsc)
      return fail(res, 'All bank details are required');
    if (!/^\d{6,20}$/.test(data.bankAccount)) return fail(res, 'Enter a valid bank account number');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(data.ifsc)) return fail(res, 'Enter a valid IFSC code');

    let bank = await Bank.findOne({ userId: req.user.id });
    if (bank) Object.assign(bank, data);
    else bank = new Bank({ userId: req.user.id, ...data });
    await bank.save();
    return ok(res, 'Bank details saved successfully', serialize.bank(bank));
  })
);

// The app reads data[0], so this returns an array.
router.get(
  '/bank-info/:userId?',
  wrap(async (req, res) => {
    const bank = await Bank.findOne({ userId: req.user.id });
    if (!bank) return fail(res, 'Please add your bank details first', 404);
    return ok(res, 'Bank details fetched', [serialize.bank(bank)]);
  })
);

const withdrawLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  keyGenerator: (req) => String(req.user.id),
  handler: (req, res) => fail(res, 'Too many attempts, please try again later', 429),
});

// Body: { userId, bankId, amount, withdrawPassword, transactionNumber }
// Amount is debited immediately and held as a pending request; admin approves or rejects (refund).
router.post(
  '/withdraw',
  withdrawLimiter,
  wrap(async (req, res) => {
    const b = req.body || {};
    const amount = toPaise(b.amount);
    if (!Number.isInteger(amount) || amount <= 0) return fail(res, 'Enter a valid amount');

    const settings = await Setting.get();
    if (amount < settings.minWithdrawPaise) return fail(res, `Minimum withdraw amount is ${fmt(settings.minWithdrawPaise)}`);

    if (!(await bcrypt.compare(str(b.withdrawPassword), req.user.withdrawalPassword)))
      return fail(res, 'Incorrect withdraw password');

    const bank = await Bank.findOne({ userId: req.user.id });
    if (!bank) return fail(res, 'Please add your bank details first');

    // Taxes are deducted from the withdrawal: the wallet is debited the full amount,
    // the user is paid amount - taxes. The itemised taxes are snapshotted on the request.
    const { items, total: tax, net } = Setting.applyWithdrawTaxes(Setting.withdrawTaxesOf(settings), amount);
    if (net <= 0) return fail(res, `Amount is too small: taxes total ${fmt(tax)}`);
    const taxNote = items.map((t) => `${t.name} ${fmt(t.amountPaise)}`).join(', ');

    const txn = await debit(req.user.id, amount, 'Withdraw', {
      note: tax > 0 ? `Withdraw request · ${taxNote} · payable ${fmt(net)}` : 'Withdraw request',
    });
    if (!txn) return fail(res, 'Insufficient Balance');

    const withdrawal = await Withdrawal.create({
      userId: req.user.id,
      bankId: bank.id,
      bank: {
        bankName: bank.bankName,
        bankAccount: bank.bankAccount,
        fullName: bank.fullName,
        ifsc: bank.ifsc,
        phoneNumber: bank.phoneNumber,
      },
      amountPaise: amount,
      taxes: items,
      taxPaise: tax,
      netPaise: net,
      transactionNumber: str(b.transactionNumber).slice(0, 64) || undefined,
    });
    txn.refId = withdrawal.id;
    await txn.save();
    return ok(
      res,
      tax > 0
        ? `Withdraw request submitted. You will receive ${fmt(net)} after taxes (${taxNote}).`
        : 'Withdraw request submitted successfully',
      serialize.withdrawal(withdrawal)
    );
  })
);

router.get(
  '/withdraw/:userId?',
  wrap(async (req, res) => {
    const list = await Withdrawal.find({ userId: req.user.id }).sort({ id: -1 }).limit(200);
    return ok(res, 'Withdrawals fetched', list.map(serialize.withdrawal));
  })
);

module.exports = router;
