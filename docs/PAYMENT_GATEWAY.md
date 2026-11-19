# UPI payment gateway (YouPI-PG)

Users can recharge their wallet by UPI through [YouPI-PG](https://github.com/youpi-pg/YouPI-PG),
a self-hosted UPI gateway. This backend is a **merchant** of your YouPI instance: it creates
payments through YouPI's REST API and credits wallets from YouPI's signed webhooks.

> YouPI describes itself as an experimental research project, not a certified payment gateway.
> Read its README notice, keep volumes small, and reconcile against your bank statements.

## Why YouPI runs as its own service

YouPI is a separate multi-service app (payment API, checkout portal, merchant admin,
bank SMS/Gmail observers, Android observer app) with its own SQLite database. It needs
Node 24 and a **persistent disk**, so it is deployed on its own — not inside this backend.
Its repository has no license file, so its code is not copied into this repo.

## Setup

1. **Deploy YouPI** from its repository (fork it, then follow its `docs/DEPLOYMENT.md`;
   it ships a `render.yaml`). Give it a public HTTPS domain, e.g. `https://pay.yourdomain.com`.
2. **Set up its observers** (`docs/OBSERVERS_SETUP.md`, `docs/ANDROID_MOBILE_APP.md`) so
   payments to your UPI account are detected.
3. In **YouPI's merchant admin**, create a merchant. Note its **Merchant ID**, **API key**
   and **webhook secret**.
4. In **our admin → Payment gateway**:
   - enter the gateway URL, merchant ID, API key and webhook secret, and the min/max recharge;
   - copy the **Webhook URL** shown there
     (`https://<this-backend>/api/v1/pay/youpi/webhook`) into the YouPI merchant's webhook setting;
   - click **Run check** — it verifies gateway health, merchant credentials (without creating
     a payment) and webhook signing;
   - switch **Enable online UPI recharge** on.

## How it works

| Step | What happens |
| --- | --- |
| App calls `POST /api/v1/pay/recharge {amount}` | We create a `GatewayPayment` and call YouPI `POST /api/v1/payments` (headers `X-Merchant-Id`, `X-Merchant-Key`, `Idempotency-Key`). The response's `checkout_url` is opened for the user. |
| User pays on YouPI's checkout | YouPI matches the UPI credit via its observers. |
| YouPI → `POST /api/v1/pay/youpi/webhook` | Verified with HMAC-SHA256 (`X-Gateway-Signature`, raw or `timestamp.body`), 2-hour replay window, de-duplicated by `X-Gateway-Delivery-Id`. |
| Credit | Wallet credited **once** (`Recharge` transaction) when the event is `RECONCILED`, or `OBSERVED_SUCCESS` if the admin chose "Observed". Only UPI, only when the amount matches. |
| Anything else | `MANUAL_REVIEW` / mismatches are never auto-credited — an admin can **Credit** after checking the bank. `SUCCESS` (COD/counter) never credits. |

### Credit rule

- **Reconciled (default, recommended by YouPI):** credit only after a bank-statement line
  matches in YouPI (statement CSV import in YouPI's admin). Safe, but not instant.
- **Observed:** credit as soon as a bank SMS/email alert matches. Instant, but an alert is not
  proof of settlement.

## App API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/pay/config` | user | `{ enabled, min, max }` |
| POST | `/api/v1/pay/recharge` | user | `{ amount }` → `{ id, checkout_url, status }` |
| GET | `/api/v1/pay/recharge/:id` | user | status of one recharge |
| GET | `/api/v1/pay/recharges` | user | recent recharges |
| POST | `/api/v1/pay/youpi/webhook` | HMAC | YouPI webhook receiver |
