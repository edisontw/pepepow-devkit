# WooCommerce Adapter Plan

Last updated: 2026-09-26

Status: **I5.4 automated acceptance complete — staging/live paid E2E remains**

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
- [x] test inside an actual WordPress/WooCommerce runtime before compatibility declaration (completed in I5.3)

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

Status: **COMPLETE — Checkout Blocks + legacy/HPOS runtime matrix verified 2026-09-26**

- [x] add server-side Checkout Block integration using `AbstractPaymentMethodType`
- [x] add client-side `registerPaymentMethod()` registration without introducing a second payment flow
- [x] keep actual checkout execution on the existing `WC_Payment_Gateway::process_payment()` contract
- [x] pin acceptance runtime to WordPress 7.1.2 / WooCommerce 11.1.2 / PHP 8.1
- [x] test Woo order creation/meta reload/`payment_complete()` with legacy storage
- [x] test the same runtime smoke with HPOS enabled
- [x] verify gateway registration, Blocks registration hook, Blocks script, and public method settings in the real Woo runtime
- [x] declare `cart_checkout_blocks` compatibility only after the matrix passed
- [x] declare `custom_order_tables` compatibility only after the matrix passed
- [x] set `WC tested up to: 11.1.2`

I5.3 verification:

- implementation commits: `a0e8e8552cdb60344a5c4f5dd753d3ce3d106c83`, `9d244c13347ae122a99e531ec3b7cb7dd2f5eeb3`
- runtime fixes: `816c27c8edb1a0a1c298aec8098e4948e117f7df`, `482bf10d2880305379b744bf851de01674b02be6`, `4e8d0755ba769413977fde168ea6a8e7bd5542e3`, `19a4a9ddd9efea2299dd901a58656a6a34be230b`
- compatibility commits: `2fefa5ee40212b0cc8a52ddcd1f5114293ddf4fe`, `02a30dd441335e3b50aba397f2443c20f9ffc4a8`
- GitHub Actions run `36231075337` completed successfully after compatibility was declared
- both `WooCommerce runtime (legacy)` and `WooCommerce runtime (hpos)` passed the pinned real runtime smoke
- existing Woo unit/static checks, merchant sample, DevKit/SDK/PepewPay, and `pepewpay-dist` remained green
## I5.4 — distributable plugin

Status: **IN PROGRESS — automated packaging/runtime acceptance complete; one staging/live paid E2E remains**

- [x] build an allowlist-based `pepew-payments.zip` with one plugin root
- [x] include runtime PHP/JS, README, uninstall handler, and MIT license only
- [x] reject test/dev directories, environment files, git files, and node modules from the ZIP
- [x] add WooCommerce extension metadata (`Requires Plugins`, author/developer, update URI, tested version)
- [x] clean-install the exact CI-built ZIP in a fresh WordPress/WooCommerce runtime
- [x] verify activation with WooCommerce present
- [x] verify activation is rejected with WooCommerce inactive and with dependency plugin files absent
- [x] force-overwrite the ZIP and verify merchant settings survive upgrade
- [x] verify deactivation preserves settings
- [x] verify explicit uninstall removes merchant API/webhook secrets while historical order payment metadata remains untouched
- [x] exercise repeated checkout/back-button semantics without issuing a second create
- [x] exercise uncertain-create transport loss + exact merchant-reference recovery
- [x] exercise signed webhook duplicate/stale/version/reorg lifecycle in both legacy and HPOS runtime modes
- [x] add install/upgrade/uninstall, webhook rotation, rollback, and production acceptance documentation
- [ ] complete one externally reachable staging/live Woo -> PepewPay -> wallet -> Payment Platform -> webhook -> Woo order paid E2E

I5.4 automated verification:

- implementation commit: `58c6e300d392e3a0a9ae581bbdebd9869b3d90e3`
- CI integration/fixes: `e67768b074f6aadd446c125fe35e07b7f15ae835`, `fa7614d26f38d62a368fb5a6e2c6cf3c3443fff6`, `e8fa4ccd879a90d93e63bebf4f2d0a662627055b`, `51f8601b591f5e252172ae8078e96cd0a5dda041`
- GitHub Actions run `36244246216` completed successfully
- `woocommerce-package`, `WooCommerce runtime (legacy)`, and `WooCommerce runtime (hpos)` all passed
- CI artifact name: `pepew-payments-woocommerce`
- the runtime merchant lifecycle test covers retry/recovery/webhook/reorg without production credentials
- production/staging paid E2E remains intentionally separate because it requires an externally reachable Woo site, merchant credentials, registered webhook endpoint, and one real wallet-signed transaction
- see `docs/WOOCOMMERCE_DEPLOYMENT.md` for the exact staging/live acceptance checklist
## Security boundary

- merchant API key: WordPress server only
- webhook signing secret: WordPress server only
- payment ID: capability shared only where intended
- wallet mnemonic/private key: never WordPress
- transaction signing: client wallet only
- Payment Platform: authoritative transaction-level state
- Woo plugin: merchant adapter only
