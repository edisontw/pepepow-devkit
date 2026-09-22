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
- load authoritative persisted checkout status from the Payment/Event Gateway with a high-entropy `payment_id`
- poll SQLite-backed status every 4 seconds while the checkout page is visible
- show exact decimal received/confirmed amounts and the required confirmation policy

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

## Persisted checkout status

This app intentionally does not use the legacy address-balance monitor as authoritative payment state.

A merchant backend creates the persisted payment through the authenticated server-to-server API and gives the customer a PepewPay capability link:

```text
https://<pepewpay-host>/?payment_id=pay_<high-entropy-id>
```

PepewPay then performs read-only requests:

```http
GET https://light.pepepow.net/api/v1/payments/{payment_id}
```

No merchant API key is present in browser JavaScript, the Payment URI, QR data, or wallet handoff.

Polling is every 4 seconds while the document is visible. Hidden tabs skip status refreshes. The backend status endpoint is SQLite-backed and does not cause equivalent ElectrumX polling.

Override the API base at build time if PepewPay is hosted against another gateway:

```text
VITE_PAYMENT_API_BASE_URL=https://light.pepepow.net/api
```

The status capability link should be treated as shareable-but-private: anyone holding the high-entropy `payment_id` can view that payment's status.
