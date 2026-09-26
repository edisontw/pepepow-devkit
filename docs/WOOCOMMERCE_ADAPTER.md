# WooCommerce Adapter Plan

Last updated: 2026-09-26

Status: **I5.2 complete — I5.3 next**

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

Status: **COMPLETE — implementation and CI verified 2026-09-26**

- [x] expose a WordPress REST webhook receiver at `/wp-json/pepew/v1/webhook`
- [x] verify Webhook v1 HMAC against exact raw request bytes before JSON parsing
- [x] enforce event-ID/header consistency, timestamp replay window, bounded body size, payment ID/version, merchant reference, and atom amount checks
- [x] keep webhook signing secret server-side in gateway settings
- [x] resolve the Woo order from deterministic site-scoped merchant reference and validate stored reference/payment/amount bindings
- [x] bind `payment_id` safely when a webhook wins the create-response race
- [x] persist current `payment_version`, PEPEW status, and last accepted event ID through WooCommerce order CRUD
- [x] ignore lower versions and make same-event retries idempotent
- [x] accept higher-version reorg rollback instead of ranking PEPEW states monotonically
- [x] use a short-lived per-event WordPress option lock to suppress concurrent duplicate processing without adding Redis/queue infrastructure
- [x] use WooCommerce `payment_complete()` for normal confirmed/overpaid transitions
- [x] move processing orders back to on-hold + review on confirmation loss, while never automatically resurrecting cancelled/refunded orders
- [x] preserve completed/refunded/cancelled business state and flag manual review when a later payment event conflicts with irreversible fulfillment/business actions
- [x] keep secrets and full capability URLs out of webhook error responses/order notes
- [x] support large JSON atom values through `JSON_BIGINT_AS_STRING`

I5.2 verification:

- DevKit commits: `a4f990540db814a1e632719155d5c3a8890ad61b`, `9bb982191cb727a955e6e50b675baaa29407f412`, `9ccf70928b44bdb3d3afdcadbe77efebca2a2fad`, `ef400850a443753a2a0bde1e010737b5bd31646b`, `62f9a1f1f8d7a23c81f45fcdad1b25005522807c`
- GitHub Actions run `36225272365` completed successfully
- WooCommerce adapter job passed PHP lint, identity parsing, exact-body webhook verifier/replay/tamper tests, large atom parsing, order-state/reorg policy tests, and no-direct-order-storage guard
- existing merchant-sample, DevKit/SDK/PepewPay, and `pepewpay-dist` jobs remained green
- real WordPress/WooCommerce/HPOS runtime acceptance remains intentionally deferred to I5.3

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
