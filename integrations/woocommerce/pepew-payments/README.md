# PEPEW Payments for WooCommerce

Status: **Phase I I5.2 complete — runtime/HPOS acceptance still pending**

This plugin is the first real platform adapter for PEPEW Payment Platform.

Current scope:

- classic WooCommerce checkout gateway via `WC_Payment_Gateway`
- PEPEW currency registration with 8 decimal places
- server-side Payment API configuration
- deterministic WooCommerce order -> `merchant_reference` mapping
- stable `Idempotency-Key` persisted before remote create
- create-response loss recovery by exact `merchant_reference`
- durable `payment_id`, payment version/status, and checkout URL stored through WooCommerce order CRUD
- redirect to PepewPay using only the public `payment_id` capability
- public WordPress REST webhook receiver at `/wp-json/pepew/v1/webhook`
- exact raw-body HMAC-SHA256 verification with 5-minute replay window
- bounded webhook body size and strict envelope/payment/reference validation
- durable order `payment_version` / last-event state for duplicate and stale-event handling
- short-lived per-event concurrency lock without adding an external queue
- reorg-safe Woo order policy that does not assume payment status is monotonic

The plugin never receives a mnemonic/private key and never signs a transaction.

## Important limitations after I5.2

This increment is intentionally incomplete:

- Checkout Block is **not supported yet** and is declared incompatible.
- HPOS runtime compatibility is **not declared yet** until a real WooCommerce test matrix passes.
- No fiat-to-PEPEW conversion exists. The order/store currency must be `PEPEW`.
- Refunds, subscriptions, tokenization, and saved methods are not supported.

Do not publish this plugin to merchants as production-ready yet.

## Architecture

The adapter does not become a second payment authority.

```text
WooCommerce order
  -> stable woo:<site-hash>:<order-id> merchant_reference
  -> stable Idempotency-Key
  -> POST /api/v1/payments
  -> payment_id
  -> PepewPay capability URL
  -> customer wallet signs/sends
  -> Payment Platform remains authoritative
```

The plugin stores only merchant integration state in WooCommerce order metadata.

## Settings

WooCommerce > Settings > Payments > PEPEW:

- Payment API origin
- PepewPay checkout base URL
- merchant API key
- merchant PEPEW receiving address
- webhook signing secret returned when registering the WordPress webhook URL with PEPEW Payment Platform
- required confirmations
- expiry seconds

The API key and webhook signing secret stay server-side. The plugin never puts either secret into redirects, browser JavaScript, order notes, or logs.

## Webhook lifecycle

Register this HTTPS receiver with PEPEW Payment Platform:

```text
https://<shop-host>/wp-json/pepew/v1/webhook
```

Store the one-time endpoint signing secret in the WooCommerce PEPEW gateway setting.
The receiver verifies the exact REST request body before parsing JSON, checks the event ID/timestamp/signature, enforces a replay window, validates the Woo merchant reference/site hash and exact amount, then applies only current/newer authoritative versions.

Order-state policy:

```text
waiting / partial / paid_unconfirmed
  -> pending/on-hold order: on-hold
  -> processing order after reorg: on-hold + manual-review flag
  -> completed/refunded/cancelled order: no automatic resurrection; manual review where money may have moved

paid_confirmed / overpaid
  -> normal unpaid/on-hold order: WooCommerce payment_complete()
  -> already processing/completed: keep state, persist newer PEPEW version
  -> cancelled/refunded: do not resurrect automatically; manual review

expired / error
  -> ordinary unpaid order: failed
  -> cancelled: leave cancelled
  -> already paid/completed/refunded: preserve business state and flag review
```

Retries with the same `event_id` are idempotent. Lower `payment_version` events cannot roll back newer merchant state. A higher-version reorg can move PEPEW state backward; the plugin reacts according to the safe policy above.

## HPOS design

I5.1 uses WooCommerce order CRUD only:

- `wc_get_order()`
- `WC_Order::get_meta()`
- `WC_Order::update_meta_data()`
- `WC_Order::save()`

It intentionally does not use direct `wp_posts`/`wp_postmeta` writes or direct SQL.

WooCommerce 11.1.2 is the current stable core release as of 2026-09-26, but this skeleton does not claim HPOS/runtime compatibility until it is tested in an actual WooCommerce environment.

## Checkout Blocks

WooCommerce's current Block Checkout payment integration requires a separate server-side `AbstractPaymentMethodType` integration plus client-side `registerPaymentMethod` registration. I5.1 does not fake compatibility with blocks; I5.3 will add and test it.

## Development checks

From the DevKit repository:

```bash
find integrations/woocommerce/pepew-payments -name '*.php' -print0 | xargs -0 -n1 php -l
php integrations/woocommerce/tests/identity-test.php
php integrations/woocommerce/tests/webhook-verifier-test.php
php integrations/woocommerce/tests/order-state-test.php
```

CI also rejects direct order-table/post-meta write APIs in the adapter.

## Next increments

- **I5.2** — complete: signed webhook receiver, durable event/version ordering, and safe Woo order transitions
- **I5.3** — Checkout Block integration + real WordPress/WooCommerce HPOS enabled/disabled test matrix, then compatibility declaration
- **I5.4** — installable ZIP/package checks, merchant setup guide, production acceptance
