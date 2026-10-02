# PEPEW Merchant Quick Start

Last updated: 2026-10-02

This is the shortest supported path from merchant credentials to a production-shaped PEPEW checkout.
It assumes the authoritative Payment Platform is `https://pay.pepepow.net`.

## 1. Trust boundary

Keep these values on the merchant backend only:

- `PEPEW_MERCHANT_API_KEY`
- `PEPEW_WEBHOOK_SIGNING_SECRET`
- merchant order/event database credentials

Customer browsers may receive only intended public payment capability data such as:

- PepewPay checkout URL containing `payment_id`
- public Payment URI/address/amount data

Never send a mnemonic, private key, merchant API key, or webhook signing secret to PepewPay or browser JavaScript.


Current production credential scope:

- Payment API v1 still uses one single-merchant Bearer namespace;
- do **not** distribute the same production merchant API key to multiple
  independent merchants;
- Phase K in the canonical server roadmap is adding explicit merchant ownership
  and scoped/revocable credentials before multi-merchant production onboarding.

This does not change the SDK header contract; the merchant backend still sends
`Authorization: Bearer <credential>`.

## 2. Install

The first public merchant SDK release is available from npm:

```bash
npm install @pepepow/pepewpay-merchant@0.1.0
```

For the repository's runnable sample application:

```bash
cd examples/merchant-app
npm install
cp .env.example .env
```

The runnable sample requires Node.js 22+. The merchant SDK itself remains Node.js 20+ compatible.

## 3. Configure merchant backend

Set in `.env`:

```text
PEPEW_MERCHANT_API_KEY=<operator-issued merchant API key>
PEPEW_RECEIVE_ADDRESS=<merchant PEPEW receiving address>
PEPEW_PAYMENT_API_ORIGIN=https://pay.pepepow.net
PEPEW_CHECKOUT_BASE_URL=https://pay.pepepow.net/
PEPEW_CONFIRMATIONS=3
PEPEW_EXPIRES_IN=900
```

Use a unique merchant order ID as `merchant_reference` and persist a stable `Idempotency-Key` before the remote create call.
Do not generate a new retry identity just because an HTTP response was lost.

## 4. Register webhook endpoint

The Payment Platform accepts public HTTPS targets on port 443 only and rejects localhost, private/reserved IPs, unsafe DNS answers, redirects, and rebinding-style targets.
Do not weaken those checks for development.

Set the public receiver URL:

```text
PEPEW_PUBLIC_WEBHOOK_URL=https://merchant.example/webhooks/pepew
```

Then run:

```bash
npm run webhook:register
```

The registration helper reads the merchant API key from the environment and does not put it in command-line arguments.
It writes the one-time endpoint `signing_secret` to `./data/webhook-registration.json` with restrictive permissions where supported and does not print the secret.

Move that secret into server-side secret storage as `PEPEW_WEBHOOK_SIGNING_SECRET`, then delete the registration file.
The endpoint is registered without an event filter so the merchant receives all supported new payment events, including state changes needed for reorg-safe processing.

## 5. Start merchant backend

```bash
npm run start:env
```

The reference server binds to `127.0.0.1:3000` by default.
In production, keep the application behind the merchant's HTTPS reverse proxy and expose only the intended webhook route publicly.

## 6. Create checkout

The sample route `POST /internal/orders` is intentionally an internal merchant route.
A real shop should invoke the same create flow only after its own authenticated order/cart logic has created the order.

```bash
curl -sS http://127.0.0.1:3000/internal/orders \
  -H 'Content-Type: application/json' \
  -d '{"order_id":"ORDER-1234","amount":"12.34"}'
```

The backend persists order identity first, then calls authenticated `POST /api/v1/payments`.
The customer receives only a checkout capability URL such as:

```text
https://pay.pepepow.net/?payment_id=pay_...
```

## 7. Lost create response / recovery

If create transport fails:

1. retry with the same `Idempotency-Key`, or
2. recover by exact `merchant_reference` through the authenticated merchant listing API

The runnable sample does the exact-reference recovery automatically after a transport failure.
If recovery is still uncertain, it keeps the original durable retry identity for a later safe retry.

## 8. Webhook processing

Always verify the HMAC against the exact raw request bytes before JSON reserialization.
After verification, one durable merchant transaction should:

1. deduplicate by `event_id`
2. locate the order by `merchant_reference` or `payment_id`
3. apply state only when `payment_version` is newer
4. record the `event_id` with the business-state decision

Return HTTP 2xx only after the event has been safely accepted.
If an order is temporarily unavailable, return a retryable response such as HTTP 409 and do not consume the event ID.

Do not rank status strings as permanently monotonic. A higher-version reorg event may legitimately move:

```text
paid_confirmed -> paid_unconfirmed
```

Framework-specific raw-body examples are under `examples/webhooks/`.

## 9. Fulfillment policy

The Payment Platform reports payment state; the merchant decides business fulfillment.
Typical policy is to fulfill only after the merchant's chosen confirmed state/confirmation threshold.
Do not automatically ship goods merely because a webhook was received.

## 10. Production checklist

- merchant API key and webhook secret are server-side only
- `.env`, SQLite state, and one-time registration files are excluded from Git
- HTTPS termination and normal merchant authentication protect order-creation routes
- public webhook route preserves exact raw body bytes
- event processing is durably idempotent by `event_id`
- state ordering uses `payment_version`, not status ranking
- create uses stable `Idempotency-Key` plus unique `merchant_reference`
- capability checkout URLs are not retained in verbose logs longer than needed
- labels/messages/references contain no passwords, tokens, medical records, or other sensitive data
- merchant database has its own backup/recovery policy
- timeout/retry logic never creates a second invoice identity for the same merchant order

## 11. Version compatibility

`Payment API v1` is the current server contract.
`@pepepow/pepewpay-merchant` 0.x follows pre-1.0 SemVer: breaking public SDK changes require a minor bump; compatible fixes/additions normally use patch bumps.
Payment API authority remains transaction-level and is not changed by an SDK package version.

Canonical server contracts remain in `pepepow-electrumx-service/docs/PAYMENT_API_V1.md`, `PAYMENT_API_AUTH.md`, and `WEBHOOKS.md`.
