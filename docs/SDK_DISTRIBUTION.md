# PEPEW SDK Distribution Policy

Last updated: 2026-09-26

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

## 2. Versioning

Packages use independent Semantic Versioning.

Current baseline:

```text
@pepepow/pepew-js             0.1.0
@pepepow/pepewpay-merchant    0.1.0
```

Before 1.0:

- breaking public API changes require a minor-version bump, for example
  `0.1.x -> 0.2.0`
- compatible fixes and compatible additive changes should normally use a
  patch-version bump
- release notes must call out behavior or contract changes that affect payment
  correctness, webhook verification, retry/idempotency, or reorg handling

A package version does not change the Payment API authority model. The
transaction-level Payment Platform remains authoritative.

## 3. Distribution channel

The intended canonical reusable-package channel is the public npm registry.

Expected install shape after the first public release:

```bash
npm install @pepepow/pepewpay-merchant
```

GitHub `main` remains the source of truth for active development. Registry
releases must come from a tested tagged commit, not from an arbitrary local
working tree.

The package metadata already declares public scoped-package access through
`publishConfig.access=public`, but `private: true` remains a hard release
gate.

## 4. Public-release gate

Do not remove `private: true` or publish a registry release until both items
below are explicitly confirmed:

1. the public package license for the distributed SDK code
2. npm `@pepepow` scope ownership plus the release credential/trusted-publishing path

This repository does not guess or silently assign a software license.

Release credentials must stay in npm/GitHub secret or trusted-publishing
facilities. Never commit npm tokens.

At release time, also verify that the intended package name and scope are
available/controlled by the project.

## 5. Pack/install verification

Phase I I1 requires the package artifact to be tested before registry
publication.

The merchant package test suite now verifies that:

- metadata names the expected scoped package and Node.js support level
- the public release gate is still active
- the tarball includes `README.md`, `package.json`, and built `dist/` output
- source and test trees are not shipped
- the tarball installs into a clean temporary Node consumer
- the consumer can import and execute the public package export

Run:

```bash
cd packages/pepewpay-merchant
npm install
npm test
```

This check uses only the locally produced tarball. It does not require a
registry publish and does not add any production VM dependency.

## 6. Release sequence

The minimum public release sequence is:

```text
main green
  -> confirm license + npm scope/release ownership
  -> remove private release gate
  -> run package tests and pack/install smoke
  -> create package-specific version commit/tag
  -> publish public npm package
  -> verify clean registry install/import
  -> record release in README / roadmap
```

A future release workflow may automate the tagged publish step, but only after
the ownership/licensing gate is resolved. Prefer npm trusted publishing or
GitHub-managed secrets over long-lived repository credentials.

## 7. Next Phase I increment

After the distribution gate is resolved, the next coherent implementation is a
complete runnable merchant sample application with a small durable SQLite
order/event store. It should demonstrate the full create -> checkout -> webhook
lifecycle without introducing Redis, PostgreSQL, queues, or framework-specific
payment authority.
