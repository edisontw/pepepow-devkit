# PEPEW Payments for WooCommerce

Status: **Phase I I5.1 development skeleton — not production-ready yet**

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

The plugin never receives a mnemonic/private key and never signs a transaction.

## Important limitations in I5.1

This increment is intentionally incomplete:

- Checkout Block is **not supported yet** and is declared incompatible.
- Webhook receipt/order-state updates are not implemented yet.
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
- required confirmations
- expiry seconds

The API key stays server-side. The plugin never puts it into redirects, browser JavaScript, order notes, or logs.

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
```

CI also rejects direct order-table/post-meta write APIs in the adapter.

## Next increments

- **I5.2** — signed webhook receiver, durable event/version ordering, Woo order status transitions
- **I5.3** — Checkout Block integration + real HPOS enabled/disabled test matrix, then compatibility declaration
- **I5.4** — installable ZIP/package checks, merchant setup guide, production acceptance
