# PepewPay

PepewPay is the non-custodial checkout/handoff application for PEPEW.

Current Phase C scope:

- create PEPEW Payment URI v1 requests
- validate address and amount locally through `@pepepow/pepew-js`
- render a QR code containing the canonical `pepew:` URI
- open a registered wallet application through the native URI
- fall back to the existing PEPEW Light web-wallet send route
- copy/share public payment intent
- build as static files
- provide a minimal manifest/service-worker PWA shell

It does **not** hold keys, derive keys, sign transactions, or accept a mnemonic.

## Development

Build the protocol package first:

```bash
cd packages/pepew-js
npm install
npm run build
```

Then:

```bash
cd apps/pepewpay
npm install
npm test
npm run build
```

The output is:

```text
apps/pepewpay/dist/
```

No Node.js runtime is required to serve that directory.

## Wallet handoff

Native:

```text
pepew:<address>?amount=<amount>&label=<label>&message=<message>
```

Current web-wallet fallback:

```text
https://light.pepepow.net/wallet/send?to=<address>&amount=<amount>
```

Override the fallback build-time URL with:

```text
VITE_PEPEW_WEB_WALLET_URL
```

Only public address/amount data is handed to the existing web wallet. Signing remains inside the wallet client.

## Status integration

This app intentionally does not use the legacy address-balance monitor as authoritative payment state.

Persisted transaction-level status will be connected after the Payment/Event Gateway API is defined in the next backend phase.
