# PEPEPOW DevKit

Developer-facing protocol and payment tooling for PEPEPOW / PEPEW.

## Scope

This repository is planned to contain:

```text
packages/
  pepew-js/

specs/
  payment-uri/

apps/
  pepewpay/

examples/
test-vectors/
```

Primary development sequence:

```text
pepew-js
  -> PEPEW Payment URI
  -> PepewPay
```

The server-side Payment/Event Gateway and webhook infrastructure belong in `edisontw/pepepow-electrumx-service`.

The client wallet, mnemonic handling, derivation, transaction construction/signing, and wallet UI belong in `edisontw/pepepow-light-wallet`.

## Security boundary

This repository may contain client-side wallet integration helpers, but server-facing packages must never require users to disclose mnemonic phrases or private keys.

Payment URI data is public payment intent. Do not put private keys, wallet recovery data, webhook secrets, API tokens, or private infrastructure endpoints into a Payment URI.

## Project roadmap

The canonical cross-repository architecture, development order, phase status, deployment plan, and Payment Platform roadmap are maintained in:

`edisontw/pepepow-electrumx-service/docs/PAYMENT_PLATFORM_ROADMAP.md`

Before substantial work, read the latest roadmap and the relevant repo documentation from GitHub `main`.

## Current status

As of 2026-09-22:

- repository created
- overall Payment Platform architecture documented
- Phase A is next: PEPEW Payment URI v1 + `pepew-js` foundation
- no production dependency on this repository yet
