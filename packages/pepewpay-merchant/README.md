# @pepepow/pepewpay-merchant

Server-side Node.js helpers for integrating a merchant backend with the PEPEW
Payment Platform.

This package is **not** for customer browsers.

Current v0.1 scope:

- authenticated payment creation
- stable `Idempotency-Key` handling
- exact `merchant_reference` recovery
- public PepewPay checkout URL construction
- webhook HMAC-SHA256 verification against exact raw body bytes
- bounded webhook timestamp replay-window verification
- `payment_version` ordering helper for reorg-safe merchant state

The package does not:

- store merchant orders
- store API keys or webhook secrets
- implement event dedup persistence
- implement order fulfillment
- derive wallet keys
- sign transactions
- replace the PEPEW Payment Platform as payment authority

Merchant applications must provide their own durable order/event storage.

## Requirements

Node.js 20 or newer.

```bash
npm install
npm test
```

The package is MIT-licensed and configured for eventual public npm
distribution under the existing package name. Publishing remains an explicit
release action; normal pushes to `main` do not publish npm packages.

The remaining external gate is confirming npm `@pepepow` scope ownership and
publisher configuration. CI already builds, packs, installs, and imports the
tarball in a clean Node consumer.

See `../../docs/SDK_DISTRIBUTION.md` for the versioning and release contract.

For an end-to-end production-shaped integration path, see `../../docs/MERCHANT_QUICK_START.md`.

## Create payment

Persist the merchant order and retry identity **before** the remote API call.

```js
import {
  MerchantClient,
  buildCheckoutUrl,
} from "@pepepow/pepewpay-merchant";

const orderId = "ORDER-1234";
const idempotencyKey = "create:ORDER-1234:v1";

// Your own durable database transaction first.
await orders.reserve({
  orderId,
  idempotencyKey,
});

const client = new MerchantClient({
  apiKey: process.env.PEPEW_MERCHANT_API_KEY,
});

const payment = await client.createPayment({
  address: process.env.PEPEW_RECEIVE_ADDRESS,
  amount: "12.34",
  merchantReference: orderId,
  idempotencyKey,
  confirmations: 3,
  expiresIn: 900,
});

await orders.bindPayment(orderId, {
  paymentId: payment.payment_id,
  paymentVersion: payment.version,
  paymentStatus: payment.status,
});

const checkoutUrl = buildCheckoutUrl(payment.payment_id);
```

The merchant API key stays on the merchant backend. Do not place it in
PepewPay URLs, browser JavaScript, Payment URIs, QR codes, logs, or wallet
handoffs.

## Recover an uncertain create

If the HTTP create response was lost, do not create a new invoice with a new
retry key.

Either repeat the same create request with the same `Idempotency-Key`, or
recover through the durable merchant reference:

```js
const payment = await client.recoverPaymentByReference("ORDER-1234");

if (payment) {
  await orders.bindPayment("ORDER-1234", {
    paymentId: payment.payment_id,
    paymentVersion: payment.version,
    paymentStatus: payment.status,
  });
}
```

## Verify webhook

Read the raw request bytes before JSON parsing or reserialization.

```js
import {
  verifyWebhook,
  isNewerPaymentVersion,
} from "@pepepow/pepewpay-merchant";

const event = verifyWebhook({
  headers: request.headers,
  rawBody,
  signingSecret: process.env.PEPEW_WEBHOOK_SIGNING_SECRET,
});
```

The verifier checks:

- `X-PepewPay-Event-Id`
- `X-PepewPay-Delivery-Id`
- `X-PepewPay-Timestamp`
- `X-PepewPay-Signature`
- HMAC-SHA256 over the exact raw body
- constant-time signature equality
- a default 300-second replay window
- Payment Event Envelope v1 shape
- signed header/body event-ID equality

After verification, durably deduplicate by `event.event_id` in the merchant's
own database.

## Reorg-safe payment state

Do not assign a fixed monotonic rank to status names.

A later chain reorg may legitimately produce:

```text
paid_confirmed -> paid_unconfirmed
```

at a higher `payment_version`.

Use:

```js
if (isNewerPaymentVersion(order.paymentVersion, event.payment_version)) {
  await orders.applyPaymentState({
    orderId,
    paymentVersion: event.payment_version,
    paymentStatus: event.data.status,
  });
}
```

The stable webhook dedup key is `event_id`. The authoritative ordering of
payment state updates is `payment_version`.

## Amount handling

Payment API responses contain exact decimal-string fields such as:

- `amount`
- `received`
- `confirmed`
- `policy_confirmed`
- `overpaid_by`

Use those strings for JavaScript business/display arithmetic that must preserve
exact PEPEW decimal values.

Do not rely on JSON numeric `*_sats` fields for arbitrary values beyond
JavaScript's safe-integer range.

## Reference flow

See:

```text
../../examples/merchant-node/README.md
../../examples/merchant-node/reference-flow.mjs
```

The canonical backend-side rationale and race/reorg guidance are maintained in
`pepepow-electrumx-service/docs/PHASE_H3_REFERENCE_MERCHANT_FLOW.md`.
