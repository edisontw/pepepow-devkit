# PepewPay

PepewPay is the non-custodial checkout/handoff application for PEPEW.

Current Phase C scope:

- create PEPEW Payment URI v1 requests
- validate address and amount locally through `@pepepow/pepew-js`
- render a QR code containing the canonical `pepew:` URI
- open a registered wallet application through the native URI
- hand off to the integrated PEPEW Wallet send route
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

Preferred web-wallet handoff:

```text
https://wallet.pepepow.net/send?to=<address>&amount=<amount>
```

The standalone PEPEW Light Wallet remains available independently at:

```text
https://light.pepepow.net/wallet/
```

It is not being retired or redirected. For controlled deployments, the handoff target can still be overridden to its send route if desired.

Override the fallback build-time URL with:

```text
VITE_PEPEW_WEB_WALLET_URL
```

Only public address/amount data is handed to the wallet client. Signing remains inside the wallet client. No mnemonic, private key, merchant API key, or payment webhook secret is included in the handoff URL.

## Persisted checkout status

This app intentionally does not use the legacy address-balance monitor as authoritative payment state.

A merchant backend creates the persisted payment through the authenticated server-to-server API and gives the customer a PepewPay capability link:

```text
https://<pepewpay-host>/?payment_id=pay_<high-entropy-id>
```

PepewPay then performs read-only requests:

```http
GET /api/v1/payments/{payment_id}
```

By default the browser uses the same origin's `/api` gateway, so one static build can be served from `light.pepepow.net` or `pay.pepepow.net` without hard-coding the authoritative host. No merchant API key is present in browser JavaScript, the Payment URI, QR data, or wallet handoff.

Polling is every 4 seconds while the document is visible. Hidden tabs skip status refreshes. The backend status endpoint is SQLite-backed and does not cause equivalent ElectrumX polling.

Override the API base at build time if PepewPay is hosted against another gateway:

```text
VITE_PAYMENT_API_BASE_URL=https://example-gateway.invalid/api
```

The status capability link should be treated as shareable-but-private: anyone holding the high-entropy `payment_id` can view that payment's status.


## Production artifact

Every successful push to `main` builds PepewPay in GitHub Actions and publishes the static output to the generated branch:

```text
pepewpay-dist
```

That branch contains deployable files only and includes `DEPLOYMENT.txt` with the source commit used for the build.

This allows the production host to deploy PepewPay without installing Node.js:

```bash
git clone --depth 1 --branch pepewpay-dist \
  https://github.com/edisontw/pepepow-devkit.git
```

The intended first production path is:

```text
https://light.pepepow.net/pay/
```

with static files served by Nginx from `/var/www/pay`.
