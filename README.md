# MachineMine Backend (Node.js + MongoDB) and Admin Panel

The backend for the `machinemine` Flutter app. It's a single Express server that provides:

- **`/api/v1/*`**: the REST API the app calls. Paths match `lib/util/app_constant.dart`.
- **`/admin`**: the admin panel (server-rendered with EJS and Bootstrap).
- **`/uploads/*`**: product and carousel images.

## Setup

```bash
cd machinemine_node
cp .env.example .env        # then edit secrets + admin password
npm install
npm run seed                # optional: sample products + creates the admin
npm start                   # or: npm run dev (auto-reload)
```

- API: `http://localhost:3000/api/v1`. The app's default `baseUrl` is `http://10.0.2.2:3000`, which is the Android emulator's address for this machine.
- Admin: `http://localhost:3000/admin`. Log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`. That account is created on first start, and you can change its password under **Settings**.

You need MongoDB 5 or later, either local or Atlas. Set it in `MONGO_URI`. In production you must set `JWT_SECRET` and `ADMIN_JWT_SECRET`.

## Response contract

Every response looks like this: `{ "status": bool, "message": string, "data": any }`. `status` is always the first key, because the app's error handler checks for that.

- **Business errors** return **400/404** with `status:false`.
- **401** is used only for a missing, invalid or blocked session. The app logs the user out when it gets a 401.
- **IDs** are auto-incrementing integers, because the Dart models parse `id` as `int`.
- **Money** is stored as integer paise and sent as strings such as `"500.00"`, because the Dart models type these fields as `String?`.
- **User identity** always comes from the JWT. The app also sends `userId` in URLs and bodies, but the server ignores it, so one user can't read or act on another user's data.

## Endpoints used by the app

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/auth/check-invite/:code` | `status:true, data:code` if the code is free |
| POST | `/api/v1/auth/register` | name, mobile, email, password, withdrawal_password, invite_code, question, answer, referred_by (the referrer's invite code) |
| POST | `/api/v1/auth/login` | mobile, password → `data` = user + `token` |
| GET | `/api/v1/auth/verify-token` | current user |
| POST | `/api/v1/auth/update-password` | currentPassword, newPassword |
| POST | `/api/v1/auth/update-withdrawal-password` | currentWithdrawalPassword, newWithdrawalPassword |
| GET | `/api/v1/pr/` | active **Normal** products |
| GET | `/api/v1/wf/` | active **Welfare** products |
| GET | `/api/v1/pr/get-product/:id` | any product, including inactive ones (needed for past purchases) |
| POST | `/api/v1/pr/buy-product` | productId → debits the price, pays referral commissions |
| GET | `/api/v1/pr/buy-product/:userId` | my products that still have something to claim |
| POST | `/api/v1/pr/update-time` | **claim** earnings on a purchase (productId = purchase id) |
| GET | `/api/v1/am/amount?mode=` | transaction history, oldest first. Returns `status:false` if empty |
| POST | `/api/v1/am/add` | only acknowledges `mode:"Collect"` (see the claim rules below) |
| POST/GET | `/api/v1/bn/bank-info[/:userId]` | save or get bank details. GET returns an array |
| POST/GET | `/api/v1/bn/withdraw[/:userId]` | request a withdrawal / list my withdrawals |
| GET | `/api/v1/cs/all` | home carousel |
| GET | `/api/v1/dt/app-info` | about us, android/iOS/Telegram links |
| GET | `/api/v1/rf/referral-summary/:userId` | 3-level team and commission earnings |
| GET | `/signup/:code` | invite link landing page (redirects to `WEB_APP_URL` if set) |

## Business rules

- **Product terms**: price `P`, duration `du` days and total return `tr`. Daily income is `di = tr / du`. Each purchase saves a copy of these terms, so editing a product later doesn't change existing purchases.
- **Claim**: earnings accrue per second at `tr / du / 86400`. A purchase can be claimed once every hour. The final claim after expiry pays exactly the remaining amount. The **server calculates the amount and credits it** as a `Collect` transaction. The app then also posts its own client-side number to `/am/add`; the server acknowledges that call but doesn't add anything, so users can't change their own payouts. Double-taps are made safe with an atomic update.
- **Recharge**: the app has no in-app payment, so the admin credits recharges from **Users → user → Wallet**.
- **Withdraw**: the server checks the withdraw password, the minimum amount (set in Settings), the bank details and the balance. The amount is **deducted from the wallet immediately** and the request is held as pending. In the admin panel, **Approve** confirms the payout, and **Reject** refunds the amount as a `WithdrawFailure` transaction.
- **Referral**: when someone buys a product, uplines on 3 levels get a percentage of the price (default 10% / 5% / 2%, set in Settings) as `Referral` transactions.
- **Transaction modes**: `Recharge`, `Collect`, `Buy`, `Withdraw`, `WithdrawFailure`, `Referral`, `Bonus`, `Deduct`.

## Admin panel

| Page | What you can do |
|---|---|
| Dashboard | See users, wallet liability, pending withdrawals, recharge/sales/payout totals and recent activity |
| Users | Search; open a user to recharge, give a bonus or deduct; edit the profile; reset the login or withdraw password; block (which logs them out); see their bank details, purchases, transactions, withdrawals and direct team |
| Products | Create or edit Normal and Welfare products with an image, per-user purchase limit, sort order and visibility. A product that has been bought is deactivated instead of deleted |
| Purchases | See all purchases, filtered by user or by active/expired |
| Withdrawals | Pending/approved/rejected queues with bank details; approve, or reject with a reason |
| Transactions | The full ledger, filtered by user or mode |
| Carousel | Home banner slides (image, caption, order, visibility) |
| Settings | About Us, app/Telegram links, referral %, minimum withdraw, signup bonus, admin password |

## Notes for the Flutter app

1. `AppConstants.baseUrl` is set to the emulator address. Change it to your server URL for real devices and for release builds.
2. `ProductController.getRefer()` currently ignores the API and uses **hard-coded mock data**. To use the real team data, uncomment `referModel = Refer.fromJson(responseModel.data);` and remove the mock. The backend already sends `earnings` as `60.00`-style decimal values, so the `double?` fields parse correctly.
