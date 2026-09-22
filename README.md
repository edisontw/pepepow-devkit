# PEPEPOW DevKit

Developer-facing protocol and payment tooling for PEPEPOW / PEPEW.

## Scope

```text
packages/
  pepew-js/

specs/
  payment-uri/
    v1.md

apps/
  pepewpay/

examples/             # later phase

test-vectors/
  payment-uri-v1.json
```

Primary development sequence:

```text
pepew-js
  -> PEPEW Payment URI
  -> PepewPay
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

## Security boundary

This repository may contain client-side wallet integration helpers, but server-facing packages must never require users to disclose mnemonic phrases or private keys.

Payment URI data is public payment intent. Do not put private keys, wallet recovery data, webhook secrets, API tokens, or private infrastructure endpoints into a Payment URI.

## Project roadmap

The canonical cross-repository architecture, development order, phase status, deployment plan, and Payment Platform roadmap are maintained in:

`edisontw/pepepow-electrumx-service/docs/PAYMENT_PLATFORM_ROADMAP.md`

Before substantial work, read the latest roadmap and relevant repo documentation from GitHub `main`.

## Current status

As of 2026-09-22:

- repository initialized
- Phase A protocol foundation is complete
- GitHub Actions Node 20 build/tests are passing
- PEPEW Payment URI v1 and shared test vectors are the current protocol baseline
- Phase A protocol foundation is complete
- Phase B payment correctness foundation is complete in `pepepow-electrumx-service`
- Phase C PepewPay supports standalone Payment URI creation and persisted transaction-level checkout status
- persisted checkout links use `?payment_id=...` and perform read-only SQLite-backed status polling
- no production Node.js runtime dependency is required
- successful `main` builds publish deployable PepewPay static files to the generated `pepewpay-dist` branch
