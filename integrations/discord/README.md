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

- exact-raw-body Ed25519 interaction signature verification using Discord's application public key
- PING -> PONG response contract
- `/pepew-pay` application-command parsing with the amount carried as a string
- deferred interaction response contract for the future real-payment path
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

The next small step is the external Discord transport smoke:

1. create a dedicated Discord application/bot and test-server installation;
2. expose one temporary HTTPS Interactions Endpoint URL to a localhost listener;
3. let Discord validate the endpoint with a signed PING;
4. register one guild-scoped `/pepew-pay` test command;
5. receive one signed command and send one ordinary bot channel message with a test-only PepewPay link button;
6. keep production Payment creation disabled during this transport smoke.

The HTTP interactions path deliberately avoids the Message Content privileged
intent and does not require a persistent Gateway connection. The command amount
is a string option so PEPEW's exact 8-decimal amount never depends on Discord or
JavaScript floating-point serialization.

The real-payment path will acknowledge/defer promptly, then use a normal bot
channel message as the durable status surface. Discord interaction tokens are
time-limited, so authoritative confirmation updates must not depend on retaining
an interaction token.

Only after transport smoke passes should the adapter add the real Payment
Platform/webhook E2E path.


## Operator transport smoke

The transport smoke intentionally creates **no Payment Platform invoice**. It
requires a dedicated Discord application/bot installed in a test server with
permission to send messages in the test channel.

Required values:

```text
DISCORD_PUBLIC_KEY        # public, from Developer Portal General Information
DISCORD_APPLICATION_ID    # public
DISCORD_GUILD_ID          # public test-server ID
DISCORD_BOT_TOKEN         # secret; server-side only
```

The smoke listener defaults to:

```text
127.0.0.1:8789/pepew-discord-e2e/interactions
```

Expose only that path through a temporary HTTPS reverse proxy. Do not expose
port 8789 directly.

Start the listener first:

```bash
cd integrations/discord

read -rsp "Discord bot token: " DISCORD_BOT_TOKEN; echo
export DISCORD_BOT_TOKEN
export DISCORD_PUBLIC_KEY="<application public key>"

npm run smoke:transport
```

While it is running, configure the public HTTPS URL as the application's
Interactions Endpoint URL in Discord Developer Portal. Discord should send a
signed PING; the terminal should report:

```text
Verified Discord PING acknowledged.
```

In a separate shell, register/update the guild-scoped test command:

```bash
cd integrations/discord

read -rsp "Discord bot token: " DISCORD_BOT_TOKEN; echo
export DISCORD_BOT_TOKEN
export DISCORD_APPLICATION_ID="<application id>"
export DISCORD_GUILD_ID="<test server id>"

npm run setup:test-command
```

Then run in the selected test channel:

```text
/pepew-pay amount:0.1
```

Successful smoke behavior:

- Discord verifies the signed interaction and receives an immediate private
  test-only acknowledgement;
- the bot posts one ordinary channel message;
- the channel message contains a HTTPS PepewPay link button;
- no merchant API key, Payment Platform webhook, invoice, PEPEW funds, wallet
  key, or signing operation is used.

After the smoke, clear the bot token from each shell:

```bash
unset DISCORD_BOT_TOKEN
```

Do not paste the bot token into chat, GitHub, command-line arguments, or logs.
If it is disclosed, reset it in the Discord Developer Portal before continuing.
