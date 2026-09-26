# PEPEW runnable merchant sample

This is the Phase I reference merchant application. It is deliberately small:
Node's built-in HTTP server, SQLite, and `@pepepow/pepewpay-merchant`.

It demonstrates the complete backend lifecycle:

```text
merchant reserves order + stable Idempotency-Key in SQLite
  -> authenticated POST /api/v1/payments
  -> durable payment_id binding
  -> return PepewPay checkout URL
  -> exact-raw-body webhook verification
  -> durable event_id deduplication
  -> payment_version ordered state updates
  -> reorg rollback remains valid
```

The sample does not hold wallet private keys and does not sign transactions.

## Requirements

- Node.js 22 or newer
- npm
- a merchant API key
- a webhook endpoint signing secret returned when the endpoint is created
- a PEPEW receiving address

The SDK itself remains Node.js 20+ compatible. The sample uses the current
`better-sqlite3` release, which requires a supported Node.js 22+ runtime.

## Install from this repository

Build the local merchant SDK first:

```bash
cd packages/pepewpay-merchant
npm install
npm run build

cd ../../examples/merchant-app
npm install
cp .env.example .env
```

Fill only the merchant backend `.env`. Never put these values in browser code:

```text
PEPEW_MERCHANT_API_KEY
PEPEW_WEBHOOK_SIGNING_SECRET
```

Register the public HTTPS webhook endpoint once after `PEPEW_PUBLIC_WEBHOOK_URL` is set:

```bash
npm run webhook:register
```

The helper stores the one-time endpoint signing secret in `./data/webhook-registration.json` without printing it. Move the secret into server-side secret storage / `.env` as `PEPEW_WEBHOOK_SIGNING_SECRET`, then delete the registration file.

Then run:

```bash
npm run start:env
```

The default bind is localhost-only:

```text
127.0.0.1:3000
```

## Create checkout

`POST /internal/orders` is an internal merchant-backend endpoint. Do not
expose it directly as an unauthenticated public checkout API. A real store
should call the equivalent code only after its own authenticated/cart/order
logic has created the order.

Local example:

```bash
curl -sS http://127.0.0.1:3000/internal/orders \
  -H 'Content-Type: application/json' \
  -d '{"order_id":"ORDER-1234","amount":"12.34"}'
```

The response contains the intended customer capability:

```json
{
  "ok": true,
  "order_id": "ORDER-1234",
  "payment_status": "waiting",
  "payment_version": 1,
  "checkout_url": "https://pay.pepepow.net/?payment_id=pay_..."
}
```

The merchant API key is never returned.

If payment creation loses its HTTP response, the application first tries exact
`merchant_reference` recovery. If recovery is still uncertain, the order
remains durably reserved with the same Idempotency-Key, so a later retry does
not need a second invoice identity.

## Webhook

Configure the Payment Platform endpoint to send to:

```text
POST /webhooks/pepew
```

The handler reads the exact raw request bytes before JSON parsing and calls
`verifyWebhook()`. Only verified events reach SQLite.

One SQLite transaction then:

1. checks durable `event_id` deduplication
2. resolves the merchant order
3. binds `payment_id` if the webhook won a create/bind race
4. applies state only when `payment_version` is newer
5. records `event_id` with the state decision

An unknown order returns HTTP 409 without consuming the event ID so webhook
retry can succeed after the local order transaction becomes visible.

A later higher-version reorg event may move:

```text
paid_confirmed -> paid_unconfirmed
```

and is intentionally applied. Do not rank status names as permanently
monotonic.

## SQLite state

Default path:

```text
./data/merchant.sqlite3
```

The example uses WAL mode, a busy timeout, restrictive database permissions
where supported, and only two tables:

```text
merchant_orders
processed_events
```

This database belongs to the sample merchant application. It is not the
authoritative PEPEW Payment Platform database.

## Production adaptation

Before using this pattern in a real merchant application:

- integrate order creation behind the merchant's own authentication/cart logic
- terminate HTTPS at the normal web tier
- expose only the webhook path that must receive Payment Platform deliveries
- keep API keys and webhook secrets in server-side secret storage
- keep durable event deduplication and order updates in one database transaction
- decide fulfillment policy explicitly; this sample stores payment state but
  does not auto-ship goods
- back up the merchant database according to the merchant's own recovery policy

No Redis, PostgreSQL, Kafka, or queue is required for this reference flow.

## Full production Quick Start

See `../../docs/MERCHANT_QUICK_START.md` for credentials, registration, recovery, webhook framework patterns, fulfillment, logging/privacy, and version-compatibility guidance.
