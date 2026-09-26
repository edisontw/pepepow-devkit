# WooCommerce Adapter Plan

Last updated: 2026-09-26

Status: **I5.1 complete — I5.2 next**

Location:

```text
integrations/woocommerce/pepew-payments/
```

## Goal

Provide a conventional WooCommerce payment gateway while keeping PEPEW Payment
Platform as the only authoritative payment ledger.

The adapter maps WooCommerce order lifecycle to the generic merchant contract:

```text
Woo order ID
  -> merchant_reference
  -> stable create idempotency
  -> payment_id
  -> PepewPay redirect
  -> webhook
  -> Woo order update
```

No mnemonic, private key, transaction signing, ElectrumX access, or blockchain
authority belongs in WordPress.

## Current WooCommerce baseline

Development targets current WooCommerce 11.1.x behavior. WooCommerce 11.1.2 is
the stable release as of 2026-09-26.

WooCommerce payment gateways still use `WC_Payment_Gateway` for the traditional
checkout. Checkout Blocks require their separate Payment Method Integration API.

HPOS is the default order-storage direction. Order code must use WooCommerce CRUD
rather than direct `wp_posts`, `wp_postmeta`, or SQL writes.

Compatibility declarations must reflect actual testing rather than intent.

## I5.1 — classic gateway skeleton

- [x] register PEPEW currency and 8-decimal pricing
- [x] add classic `WC_Payment_Gateway`
- [x] add server-only Payment API settings
- [x] generate deterministic cross-store-safe merchant reference
- [x] persist merchant reference and idempotency key before remote create
- [x] create payment through Payment API v1
- [x] recover uncertain create by exact merchant reference
- [x] persist payment capability/version/status through Woo order CRUD
- [x] redirect shopper to PepewPay
- [x] explicitly declare Checkout Blocks incompatible for this increment
- [x] add PHP lint, identity tests, and no-direct-order-storage guard
- [x] CI verify PHP syntax, deterministic order identity, and no direct order-storage writes
- [ ] test inside an actual WordPress/WooCommerce runtime before any compatibility claim

Merchant identity format:

```text
merchant_reference = woo:<sha256(site-url)[0:16]>:<order-id>
Idempotency-Key    = woo:create:<sha256(site-url)[0:16]>:<order-id>:v1
```

This avoids PII and makes the same Woo order stable across browser retries while
reducing collision risk if one Payment Platform credential eventually serves
more than one Woo store.

## I5.1 verification

- DevKit commits: `abb67d5c9e8cbab98196b9f204c2bbe56154dad7`, `7d7bdbeeacc3354c9ce2e14d943d3dbb70e91d60`, `522c0fea18b85003ffe0f6e3cc5d707f9f3eea3f`
- GitHub Actions run `36223238329` completed successfully
- WooCommerce adapter job passed PHP lint, deterministic identity tests, and the no-direct-order-storage guard
- Existing merchant-sample, DevKit/SDK/PepewPay, and `pepewpay-dist` jobs remained green
- I5.1 also snapshots the exact 8-decimal Woo order amount before remote create and fails closed if the order amount later differs from the stored/payment amount

## I5.2 — webhook and order lifecycle

Implement exact-raw-body HMAC verification in PHP using the existing Webhook v1
contract. Then:

- resolve order from merchant reference/payment ID
- durably reject duplicate/stale events
- accept higher `payment_version` even when status moves backward on reorg
- map waiting/unconfirmed/confirmed/expired behavior to Woo order semantics
- never mark paid merely because a callback arrived; verified authoritative
  state/version drives the transition
- do not expose signing secrets in logs/order notes

## I5.3 — Blocks + HPOS acceptance

Add Checkout Block support using WooCommerce's current payment-method
integration interfaces.

Run a real WooCommerce matrix with HPOS enabled and disabled. Only after that
passes:

- declare `custom_order_tables` compatibility
- declare `cart_checkout_blocks` compatibility
- update `WC tested up to`

Until then, compatibility must not be overstated.

## I5.4 — distributable plugin

- produce installable plugin ZIP
- add setup/upgrade/uninstall documentation
- test activation with WooCommerce absent/present
- test repeated checkout retries and browser back/forward
- test webhook duplicate/retry/reorg
- test order recovery after PHP/HTTP failure
- document production webhook registration and secret rotation
- complete one staging/live Woo checkout E2E before calling the adapter ready

## Security boundary

- merchant API key: WordPress server only
- webhook signing secret: WordPress server only
- payment ID: capability shared only where intended
- wallet mnemonic/private key: never WordPress
- transaction signing: client wallet only
- Payment Platform: authoritative transaction-level state
- Woo plugin: merchant adapter only
