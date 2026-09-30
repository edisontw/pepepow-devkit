# PEPEW Discord Merchant Payment Adapter

Status: **I5.6 contract baseline started**

This directory is the merchant-side Discord payment adapter for the PEPEW
Payment Platform. It is not a wallet and contains no mnemonic, private-key,
derivation, UTXO-selection, or transaction-signing logic.

## Boundary

The intended Discord flow is:

```text
Discord slash command / interaction
  -> merchant backend acknowledges/defer quickly
  -> stable hashed payment identity
  -> authoritative Payment API create/recovery
  -> normal Discord bot channel message with a PepewPay link button
  -> signed Payment Platform webhook
  -> edit the same Discord bot message by increasing payment_version
```

A normal bot channel message is preferred for the durable payment-status
surface instead of relying on a short-lived interaction token for later
confirmation updates.

Payment authority remains in `pay.pepepow.net`. Wallet handoff remains
non-custodial and signing remains client-side.

## Stable identity

The v1 Discord merchant identity is derived from:

```text
application_id + channel_id + interaction_id
```

The raw Discord identifiers are hashed before entering
`merchant_reference` or `Idempotency-Key`.

No Discord user ID is required for payment authority.

## Secret boundary

Server-side only:

```text
DISCORD_BOT_TOKEN
PEPEW_MERCHANT_API_KEY
PEPEW_WEBHOOK_SIGNING_SECRET
```

A later HTTP interactions transport will additionally verify Discord request
signatures using the application's public verification key. No secret belongs
in the PepewPay checkout URL, PEPEW Payment URI, Discord-visible message, logs,
or GitHub.

## Current baseline

Implemented without Discord credentials or network access:

- stable hashed merchant reference and idempotency key
- exact PEPEW amount validation
- Payment API create through `@pepepow/pepewpay-merchant`
- exact-reference recovery after uncertain create transport
- HTTPS-only PepewPay link button payload
- Discord `allowed_mentions` suppression
- increasing-`payment_version` ordering
- confirmation-safe `overpaid` handling
- terminal paid/expired/error mapping

## Test

On a fresh clone, build the local merchant SDK first:

```bash
cd packages/pepewpay-merchant
npm install
npm run build

cd ../../integrations/discord
npm install
npm test
```

The contract tests use no Discord token, Payment Platform credential, PEPEW
funds, or external network.

## Next increment

The next small step is Discord transport/authentication:

1. verify Discord interaction signatures against the exact request body;
2. handle PING and one bounded slash-command request;
3. acknowledge/defer within Discord's interaction deadline;
4. send one ordinary bot channel message with the PepewPay link button;
5. keep production Payment creation disabled during the first transport smoke.

Only after transport smoke passes should the adapter add the real Payment
Platform/webhook E2E path.
