# PEPEW Merchant Testing and Sandbox Strategy

Last updated: 2026-09-26

This is the Phase I I4 developer test strategy. It makes merchant integration repeatable without weakening production webhook/network controls or adding always-on infrastructure before it is needed.

## 1. Test layers

### Layer A — deterministic local contract tests

Default for development and CI.

- no production API credential
- no PEPEW funds
- no network dependency
- no public webhook endpoint
- no ElectrumX dependency
- deterministic payment IDs, event IDs, timestamps, and signatures
- exercises the real `MerchantClient`, webhook verifier, merchant SQLite store, idempotency, duplicate delivery, and reorg-safe `payment_version` ordering

Implementation:

```text
examples/merchant-app/test-support/mock-payment-platform.mjs
examples/merchant-app/tests/contract-harness.test.mjs
```

Run:

```bash
cd examples/merchant-app
npm test
```

The mock is a contract fixture, not payment authority or a blockchain simulator. Authoritative server semantics remain in `pepepow-electrumx-service`.

### Layer B — bounded live smoke

Use only when an authorized operator deliberately wants to confirm compatibility with the live Payment API.

The live smoke:

- is never run by CI
- requires an API key and real receiving address at runtime
- requires a unique `SMOKE-*` merchant reference
- requires the explicit guard `CREATE_ONE_EXPIRING_PAYMENT`
- creates at most one five-minute payment intent per invocation
- verifies exact-reference recovery and public capability status
- does not send funds
- does not create, disable, or modify webhook endpoints
- does not print the full payment capability ID

Required environment:

```text
PEPEW_LIVE_SMOKE_CONFIRM=CREATE_ONE_EXPIRING_PAYMENT
PEPEW_LIVE_SMOKE_REFERENCE=SMOKE-<unique-id>
PEPEW_LIVE_SMOKE_AMOUNT=<small positive amount>
PEPEW_MERCHANT_API_KEY=<authorized key>
PEPEW_RECEIVE_ADDRESS=<merchant address>
```

Run:

```bash
cd examples/merchant-app
npm run smoke:live
```

Each run leaves one normal expiring payment record/event in the authoritative platform. This is an operational smoke, not a unit test.

### Layer C — real paid/webhook E2E

Use rarely for release or production acceptance when blockchain and webhook delivery itself must be proven.

This may require an actual PEPEW transfer, a public HTTPS receiver on port 443, endpoint registration/signing-secret handling, and deliberate receiver failure when testing webhook retry.

The server repository owns production acceptance and webhook E2E procedures. Do not duplicate production authority logic inside the DevKit.

## 2. Local webhook testing

Do not disable production SSRF checks to make localhost callbacks work.

Local tests generate exact signed webhook bytes and headers in-process, then pass them through `verifyWebhook()` and durable merchant storage.

Keep coverage for:

```text
create persisted -> HTTP response lost -> exact reference recovery
same Idempotency-Key + same request -> same payment
same Idempotency-Key + changed request -> conflict
duplicate event_id -> no duplicate business update
lower payment_version -> stale/no rollback
higher payment_version paid_confirmed -> paid_unconfirmed -> apply reorg
```

Production endpoint validation remains HTTPS-only, public-network-only, port 443, and revalidated on delivery.

## 3. Credential and data isolation

Payment API v1 currently uses the existing single-merchant Bearer boundary. There is no general-purpose public sandbox credential or multi-tenant developer credential model yet.

Therefore:

- external/untrusted developers use Layer A, not production credentials
- CI never receives the production merchant API key or webhook secret
- live smoke credentials stay only in authorized operator/server secret storage
- test references use a recognizable `SMOKE-` prefix
- test payloads contain no customer personal data
- local SQLite test state uses temporary paths and is removed after tests

A future public sandbox must not reuse the production merchant credential.

## 4. When to add a dedicated sandbox

Do not create another always-on Payment Platform host yet.

A dedicated sandbox becomes justified when real demand appears, for example:

- multiple external merchants need credentials concurrently
- WooCommerce/plugin CI needs repeatable network-level API access
- manual live-smoke rows become operational noise
- public webhook callback testing becomes frequent
- a stable PEPEW test-network/funding path is available for automated paid E2E
- production single-merchant credentials no longer provide adequate isolation

Before deployment, define sandbox credential scope/rotation, separate database and webhook master key, retention/reset policy, rate limits, test funding, TLS/domain, resource budget, and a prohibition on real customer data.

Never point sandbox writers at the production SQLite database.

## 5. Current decision

Phase I uses Layer A as the normal developer experience, Layer B as operator-only compatibility smoke, and Layer C as deliberate release/production acceptance.

No dedicated always-on sandbox infrastructure is required yet.
