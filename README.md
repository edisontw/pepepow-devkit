# PEPEPOW DevKit

Developer-facing protocol, checkout, merchant integration, and payment-adapter tooling for PEPEPOW / PEPEW.

## Repository layout

~~~text
packages/
  pepew-js/                 Payment URI parsing/serialization and address helpers
  pepewpay-merchant/        Server-side merchant SDK

apps/
  pepewpay/                 Public checkout UI

integrations/
  woocommerce/
  telegram/
  discord/

community-bots/              Legacy community status bots migrated off MN5

examples/
  merchant-node/
  merchant-app/

specs/
  payment-uri/v1.md

test-vectors/
  payment-uri-v1.json
  merchant-namespaces-v1.json
~~~

Server-side Payment/Event Gateway, authoritative payment state, webhook infrastructure, and production persistence belong in edisontw/pepepow-electrumx-service.

Wallet mnemonic handling, derivation, transaction construction/signing, and wallet UI belong in edisontw/pepepow-light-wallet.

## Core components

### PEPEW Payment URI

The canonical v1 format uses exact 8-decimal PEPEW amounts and PEPEPOW P2PKH Base58Check addresses.

Example:

~~~text
pepew:PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb?amount=12.34&label=Coffee%20Shop&message=Order%201234
~~~

Specification: specs/payment-uri/v1.md

### PepewPay

apps/pepewpay is a static checkout UI that:

- reads public payment capability state from the Payment Platform;
- generates PEPEW Payment URI/QR output;
- hands payment to a compatible wallet;
- contains no mnemonic, private-key, derivation, or signing logic.

### Merchant SDK

packages/pepewpay-merchant provides server-side helpers for:

- authenticated payment create/recovery;
- public checkout URL construction;
- exact-raw-body webhook verification;
- replay-window validation;
- payment_version ordering.

Merchant credentials and webhook signing secrets are server-side only.

### Integrations

Production-shaped payment integrations are available for:

- WooCommerce
- Telegram
- Discord

Low-volume community status bots are maintained separately under `community-bots/`. They use PEPEW Light as the single public data boundary for price and network summaries and are intended to run on edison2 rather than the pool host.

The Payment Platform remains authoritative for payment state. Integrations must not infer merchant payment completion from current address balance alone.

## Telegram and Discord payment bots

Current command contract:

~~~text
Telegram private / group / supergroup
/pay <PEPEW-address> <amount>

Discord
/pepew-pay address:<PEPEW-address> amount:<amount>
~~~

The receiving address is supplied with each request. The always-on bot runtimes do not use a fixed PEPEW_RECEIVE_ADDRESS.

Bot runtimes may keep multiple outstanding payments concurrently when they use different receiving addresses. The Payment Platform rejects overlapping payment time windows for the same receiving address with HTTP `409 payment_address_in_use`; this protection is global across merchants/integrations.

Production runtime/deployment:

- docs/BOT_OPERATIONS.md — day-to-day use and checks
- deploy/edison2/README.md — installation, upgrade, recovery
- integrations/telegram/README.md — Telegram adapter
- integrations/discord/README.md — Discord adapter

## Development

Node.js 20+ is used for DevKit development and CI.

Payment URI package:

~~~bash
cd packages/pepew-js
npm install
npm test
~~~

Merchant SDK:

~~~bash
cd packages/pepewpay-merchant
npm install
npm test
npm run build
~~~

Telegram:

~~~bash
cd integrations/telegram
npm install
npm test
~~~

Discord:

~~~bash
cd integrations/discord
npm install
npm test
~~~

Successful main builds also produce the static PepewPay deployment artifact.

## Security boundaries

Never place any of the following in public URLs, Payment URIs, logs, GitHub, or chat:

- mnemonic / seed phrase
- private key or signing material
- merchant API credential
- webhook signing secret
- bot token
- private infrastructure credentials

Payment signing remains client-side.

## Current status

As of 2026-10-03:

- PEPEW Payment URI v1 is stable.
- PepewPay is deployed and uses transaction-level Payment Platform state.
- @pepepow/pepew-js and @pepepow/pepewpay-merchant 0.1.0 are published.
- WooCommerce, Telegram, and Discord integrations are implemented and contract-tested.
- multi-merchant scoped credentials are supported without changing the merchant SDK Bearer transport.
- Telegram/Discord always-on production runtimes use a user-supplied receiving address per payment command; the corrected contract was deployed and real Telegram/Discord payments passed on 2026-10-03.
- Telegram private/group/supergroup `/pay` support is deployed on edison2; live group payment acceptance passed on 2026-10-03.
- Concurrent bot payments for different receiving addresses are deployed and production-accepted. On 2026-10-04, Telegram held two simultaneous outstanding payments on different addresses (`pending_payments=2`), Telegram rejected reuse of an active address, and Discord also rejected reuse of that Telegram-reserved address, confirming authoritative cross-bot protection on the Payment Platform.

Detailed phase history and production architecture are maintained in edisontw/pepepow-electrumx-service/docs/PAYMENT_PLATFORM_ROADMAP.md.

## License

Reusable DevKit and SDK artifacts are MIT licensed. See LICENSE.
