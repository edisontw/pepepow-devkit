# PEPEW SDK Distribution Policy

Last updated: 2026-10-02

This document defines the Phase I package-distribution baseline for reusable
PEPEW developer packages in `pepepow-devkit`.

The canonical cross-repository phase status remains
`pepepow-electrumx-service/docs/PAYMENT_PLATFORM_ROADMAP.md`.

## 1. Package boundaries

Reusable packages keep separate trust boundaries:

| Package | Runtime | Purpose | Secrets |
| --- | --- | --- | --- |
| `@pepepow/pepew-js` | browser / Node | Payment URI, amount, and public protocol utilities | none |
| `@pepepow/pepewpay-merchant` | server-side Node.js 20+ | merchant create/recovery, checkout URL, webhook verification, payment-version helpers | merchant application supplies secrets at runtime |

PepewPay itself remains a static application artifact published through the
generated `pepewpay-dist` branch. It is not a server SDK dependency.

Mnemonic, private-key derivation, transaction signing, merchant API keys, and
webhook signing secrets must not be embedded into published package contents.

## 2. License and versioning

The DevKit and reusable SDK package artifacts use the MIT License.

Packages use independent Semantic Versioning.

Current baseline:

```text
@pepepow/pepew-js             0.1.0
@pepepow/pepewpay-merchant    0.1.0
```

Before 1.0:

- breaking public API changes require a minor-version bump
- compatible fixes and compatible additive changes should normally use a patch bump
- release notes must call out changes affecting payment correctness, webhook verification, retry/idempotency, or reorg handling

A package version does not change the Payment API authority model. The
transaction-level Payment Platform remains authoritative.

## 3. Distribution channel

The intended canonical reusable-package channel is the public npm registry.

Expected install shape after public release:

```bash
npm install @pepepow/pepew-js
npm install @pepepow/pepewpay-merchant
```

GitHub `main` remains the source of truth for active development. Registry
releases must come from a tested tagged commit, not from an arbitrary local
working tree.

Both SDK manifests are public-release-ready with MIT licensing,
`publishConfig.access=public`, and the canonical npm registry. Normal pushes
to `main` do not publish npm packages.

## 4. First public release status

Completed on 2026-10-02:

1. npm `@pepepow` organization/scope ownership was confirmed under the operator account;
2. release tags `pepew-js-v0.1.0` and `pepewpay-merchant-v0.1.0` were created from DevKit commit `87dd9199ebc79be156c27d0fab3df4967d762346`, whose CI run was green;
3. `@pepepow/pepew-js@0.1.0` and `@pepepow/pepewpay-merchant@0.1.0` were published interactively with npm authentication/2FA;
4. both packages were installed from the public registry into a fresh temporary consumer and their public imports executed successfully.

The bootstrap runbook and future-release procedure are in [NPM_FIRST_RELEASE.md](NPM_FIRST_RELEASE.md). On 2026-10-02, npm Trusted Publisher configuration was completed for both public packages against GitHub Actions workflow `npm-release.yml`. Future releases should therefore use OIDC rather than introducing a long-lived npm write token. The first OIDC publish should be exercised on the next legitimate package release rather than creating an artificial version solely to test the transport.

Release credentials must stay in npm/GitHub secret or trusted-publishing
facilities. Never commit npm tokens.

If the `@pepepow` scope cannot be obtained, choose a deliberate alternate
scope rather than silently publishing under an unrelated namespace.

Repository visibility is separate. Do not make the entire Git repository
public until repository history has also been checked for removed credentials
or sensitive deployment material.

## 5. Pack/install verification

The SDK package test suites verify that:

- metadata names the expected scoped package and Node.js support level
- package license is MIT and public registry access is explicit
- tarballs include `LICENSE`, `README.md`, `package.json`, and built `dist/`
- source and test trees are not shipped
- tarballs install into clean temporary Node consumers
- consumers can import and execute the public package exports

Run:

```bash
cd packages/pepew-js
npm install
npm test

cd ../pepewpay-merchant
npm install
npm test
```

This uses only locally produced tarballs. It does not require a registry
publish and adds no production VM dependency.

## 6. Release sequence

```text
main green
  -> confirm npm scope/release ownership
  -> run package tests and pack/install smoke
  -> create package-specific version commit/tag
  -> publish public npm package
  -> verify clean registry install/import
  -> configure npm trusted publishing for subsequent releases
  -> record release in README / roadmap
```

Prefer npm trusted publishing with GitHub Actions OIDC over long-lived registry
credentials.

## 7. Phase I implementation status

I2 is complete in `examples/merchant-app/` with a small durable SQLite
order/event store, stable create identity, uncertain-create recovery,
exact-raw-body webhook verification, durable event deduplication, and
reorg-safe `payment_version` ordering.

I3 is complete in `docs/MERCHANT_QUICK_START.md` with production configuration,
secure webhook registration, timeout/recovery guidance, fulfillment/logging
boundaries, version compatibility, and copyable Express/Fastify raw-body
patterns under `examples/webhooks/`.

I4 is complete in `docs/TESTING_AND_SANDBOX.md` with a deterministic,
zero-network contract harness for normal development/CI plus an explicit
operator-only live smoke path. Production webhook SSRF/HTTPS protections remain
unchanged, and no always-on sandbox service has been introduced.

I5 has started with a WooCommerce adapter under
`integrations/woocommerce/pepew-payments/`. I5.1 is complete: classic checkout
can create/recover a PEPEW payment intent, persist stable Woo order identity
and exact amount snapshot state through WooCommerce CRUD, and redirect to
PepewPay without moving payment authority into WordPress.

I5.2 is also complete: the adapter now has an exact-raw-body signed webhook
receiver, durable event/version ordering, race-safe payment binding, and
reorg-aware Woo order transitions that avoid automatically resurrecting
cancelled/refunded business state.

I5.3 is complete: the Woo adapter now supports Checkout Blocks and has passed
a pinned WordPress 7.1.2 / WooCommerce 11.1.2 runtime matrix with both legacy
order storage and HPOS enabled. The plugin now declares both
`cart_checkout_blocks` and `custom_order_tables` compatibility.

I5.4 is complete: CI builds an allowlist-based WooCommerce ZIP, install-tests it in a clean WordPress/WooCommerce runtime, verifies dependency/upgrade/uninstall behavior, and exercises retry/recovery/webhook/reorg flows in both legacy and HPOS modes. The externally reachable staging/live paid checkout E2E also passed on 2026-09-30 through Woo checkout -> PepewPay -> integrated Wallet -> authoritative Payment Platform -> signed webhook -> Woo order paid.

I1 is complete: both first public SDK packages were published as `0.1.0` from exact release tags and clean public-registry install/import smoke passed on 2026-10-02. I5.4, I5.5, and I5.6 are also complete, including the Discord temporary-infrastructure cleanup audit. Phase I therefore satisfies its distribution and integration exit criteria.
