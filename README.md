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

Production-shaped integrations are available for:

- WooCommerce
- Telegram
- Discord

The Payment Platform remains authoritative for payment state. Integrations must not infer merchant payment completion from current address balance alone.

## Telegram and Discord payment bots

Current command contract:

~~~text
Telegram
/pay <PEPEW-address> <amount>

Discord
/pepew-pay address:<PEPEW-address> amount:<amount>
~~~

The receiving address is supplied with each request. The always-on bot runtimes do not use a fixed PEPEW_RECEIVE_ADDRESS.

Current low-volume policy permits one outstanding payment per bot at a time. This is a concurrency limit, not an address-allocation requirement.

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
- Telegram/Discord always-on runtime code uses a user-supplied receiving address per payment command.

Detailed phase history and production architecture are maintained in edisontw/pepepow-electrumx-service/docs/PAYMENT_PLATFORM_ROADMAP.md.

## License

Reusable DevKit and SDK artifacts are MIT licensed. See LICENSE.
