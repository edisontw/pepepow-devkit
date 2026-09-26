# PEPEPOW DevKit

Developer-facing protocol and payment tooling for PEPEPOW / PEPEW.

## Scope

```text
packages/
  pepew-js/
  pepewpay-merchant/

specs/
  payment-uri/
    v1.md

apps/
  pepewpay/

examples/
  merchant-node/
  merchant-app/

test-vectors/
  payment-uri-v1.json
```

Primary development sequence:

```text
pepew-js
  -> PEPEW Payment URI
  -> PepewPay
  -> merchant SDK/helpers
  -> Phase I merchant onboarding / distribution
```

The server-side Payment/Event Gateway and webhook infrastructure belong in `edisontw/pepepow-electrumx-service`.

The client wallet, mnemonic handling, derivation, transaction construction/signing, and wallet UI belong in `edisontw/pepepow-light-wallet`.

## Phase A protocol foundation

Implemented on `main`:

- PEPEW Payment URI v1 specification
- exact 8-decimal PEPEW amount handling
- PEPEPOW P2PKH Base58Check validation using version byte `0x37`
- deterministic Payment URI parser/serializer
- shared valid/invalid URI test vectors
- Node 20 build/test workflow

Canonical example:

```text
pepew:PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb?amount=12.34&label=Coffee%20Shop&message=Order%201234
```

Development:

```bash
cd packages/pepew-js
npm install
npm test
```

Production PEPEW Light does not require Node.js for this work. Frontend artifacts can be built in CI or on a development machine.

## Phase C PepewPay

Implemented on `main`:

- static Vite/React checkout shell
- PEPEW Payment URI v1 QR generation
- native `pepew:` wallet handoff
- PEPEW Light web-wallet fallback
- share/copy flow for public payment intent
- minimal manifest/service-worker PWA shell
- no mnemonic, private-key, derivation, or signing code
- Node is required only at build time; `dist/` is static output

Persisted transaction-level payment status is connected to the Payment/Event Gateway through read-only high-entropy payment capability IDs.

See `apps/pepewpay/README.md` for development and handoff details.

## Phase H4 merchant helpers

Implemented on `main`:

- server-side `@pepepow/pepewpay-merchant` package for Node.js 20+
- authenticated payment create helper
- exact `merchant_reference` recovery helper
- customer checkout URL builder that exposes only `payment_id`
- exact-raw-body webhook HMAC verification
- constant-time signature comparison and bounded replay-window validation
- reorg-safe `payment_version` ordering helper
- framework-neutral durable-store composition example under `examples/merchant-node/`
- no merchant secret handling in browser packages or PepewPay

The merchant package is intentionally separate from `@pepepow/pepew-js` so
server credentials and webhook verification code do not become part of the
browser/protocol package.

See:

```text
packages/pepewpay-merchant/README.md
examples/merchant-node/README.md
```

Phase I distribution policy is documented in:

```text
docs/SDK_DISTRIBUTION.md
```

Merchant production onboarding is documented in:

```text
docs/MERCHANT_QUICK_START.md
```

The runnable merchant application is:

```text
examples/merchant-app/
```

The reusable SDK code is MIT-licensed and both SDK package manifests are
public-release-ready. Normal pushes to `main` never publish npm packages. The
remaining external release gate is npm `@pepepow` scope ownership/publisher
setup. CI validates packed artifacts in clean Node consumers before registry
release.

## License

PEPEPOW DevKit and the reusable SDK artifacts are licensed under the MIT
License. See `LICENSE`.

Public SDK distribution does not change secret boundaries: mnemonic/private
keys, merchant API keys, webhook signing secrets, npm credentials, and
production infrastructure secrets must never be committed or packaged.

## Security boundary

This repository may contain client-side wallet integration helpers, but server-facing packages must never require users to disclose mnemonic phrases or private keys.

Payment URI data is public payment intent. Do not put private keys, wallet recovery data, webhook secrets, API tokens, or private infrastructure endpoints into a Payment URI.

## Project roadmap

The canonical cross-repository architecture, development order, phase status, deployment plan, and Payment Platform roadmap are maintained in:

`edisontw/pepepow-electrumx-service/docs/PAYMENT_PLATFORM_ROADMAP.md`

Before substantial work, read the latest roadmap and relevant repo documentation from GitHub `main`.

## Current status

As of 2026-09-26:

- repository initialized
- Phase A protocol foundation is complete
- GitHub Actions Node 20 build/tests are passing
- PEPEW Payment URI v1 and shared test vectors are the current protocol baseline
- Phase A protocol foundation is complete
- Phase B payment correctness foundation is complete in `pepepow-electrumx-service`
- Phase C PepewPay is complete, including production static deployment and live transaction-level checkout E2E
- persisted checkout links use `?payment_id=...` and perform read-only SQLite-backed status polling
- no production Node.js runtime dependency is required
- successful `main` builds publish deployable PepewPay static files to the generated `pepewpay-dist` branch
- production validation on 2026-09-22 completed a new 0.1 PEPEW checkout through web-wallet handoff, broadcast, `paid_unconfirmed`, and `paid_confirmed`
- Phase H3 reference merchant flow is complete in `pepepow-electrumx-service`
- Phase H4 adds the server-side `@pepepow/pepewpay-merchant` helpers and durable-store composition examples
- Phase I I1 defines MIT/public-ready SDK distribution with npm scope ownership still external
- Phase I I2 adds a runnable Node + SQLite merchant application with durable idempotency, create recovery, webhook deduplication, and reorg-safe payment_version handling
- Phase I I3 adds a production merchant Quick Start, secure webhook registration helper, and Express/Fastify exact-raw-body integration patterns
