# Node.js merchant reference flow

This directory demonstrates how to compose
`@pepepow/pepewpay-merchant` with a merchant application's own durable store.

It deliberately does not provide a toy in-memory order database.

A correct merchant integration needs durable storage for:

```text
order_id / merchant_reference
stable Idempotency-Key
payment_id
latest payment_version
latest payment status
processed webhook event_id values
business fulfillment state
```

## Flow

```text
merchant DB reserve order + Idempotency-Key
        |
        v
MerchantClient.createPayment()
        |
        v
merchant DB bind payment_id/version/status
        |
        v
customer gets ?payment_id=... checkout URL
        |
        v
PepewPay / wallet payment
        |
        v
signed webhook
        |
        v
verifyWebhook(exact raw bytes)
        |
        v
merchant DB transaction:
  event_id dedup
  + payment_version ordering
  + business update
```

If create times out, call `recoverPaymentByReference()` or retry the same create
with the same Idempotency-Key. Do not create a second invoice just because the
first HTTP response was lost.

For a webhook whose order is not yet available locally, return a retryable
response (for example HTTP 409) rather than recording its `event_id` as
successfully consumed.

See `reference-flow.mjs` for framework-neutral composition code.

The full H3 reasoning and race/reorg boundaries live in:

```text
edisontw/pepepow-electrumx-service/docs/PHASE_H3_REFERENCE_MERCHANT_FLOW.md
```
