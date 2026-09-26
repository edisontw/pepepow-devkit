# Webhook framework patterns

These files demonstrate one critical integration rule: preserve the exact request body bytes until `verifyWebhook()` succeeds.

- `express.mjs`: place `express.raw()` on the webhook route before any global `express.json()` middleware.
- `fastify.mjs`: isolated raw JSON parser example; in a larger app scope it to a plugin so unrelated JSON routes keep normal parsing.

The examples intentionally leave `applyVerifiedEvent()` unimplemented.
A production application must replace it with one durable database transaction that handles `event_id` deduplication, order lookup, `payment_version` ordering, and business state.

Unknown/not-yet-visible orders should return a retryable status such as HTTP 409 without recording the event as consumed.

Install the framework plus `@pepepow/pepewpay-merchant` in the merchant application, not in customer/browser code.
