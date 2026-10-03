# PEPEW Discord Merchant Payment Adapter

Status: **I5.6 COMPLETE — live payment/webhook acceptance and temporary-infrastructure cleanup verified 2026-10-01**

This directory is the merchant-side Discord payment adapter for the PEPEW
Payment Platform. It is not a wallet and contains no mnemonic, private-key,
derivation, UTXO-selection, or transaction-signing logic.

## Boundary

The intended Discord flow is:

```text
Discord slash command / interaction
  -> exact-body Ed25519 verification
  -> immediate acknowledgement
  -> stable hashed payment identity
  -> authoritative Payment API create/recovery
  -> normal Discord bot channel message with a PepewPay link button
  -> integrated Wallet
  -> signed Payment Platform webhook
  -> edit the same Discord bot message by increasing payment_version
```

A normal bot channel message is the durable payment-status surface. Long-lived
confirmation updates do not depend on a Discord interaction token.

Payment authority remains in `pay.pepepow.net`. Wallet handoff remains
non-custodial and transaction signing remains client-side.

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

The Discord application public key and application ID are public identifiers.
No secret belongs in the PepewPay checkout URL, PEPEW Payment URI,
Discord-visible message, logs, GitHub, or command-line arguments.

## Current baseline

Implemented:

- exact-raw-body Ed25519 interaction signature verification using Discord's
  application public key
- PING -> PONG response contract
- `/pepew-pay` application-command parsing with the amount carried as a string
- stable hashed merchant reference and idempotency key
- exact PEPEW amount validation
- Payment API create through `@pepepow/pepewpay-merchant`
- exact-reference recovery after uncertain create transport
- HTTPS-only PepewPay link button payload
- Discord `allowed_mentions` suppression
- increasing-`payment_version` ordering
- confirmation-safe `overpaid` handling
- terminal paid/expired/error mapping
- normal bot channel-message create and edit helpers
- bounded credential-free transport harness
- bounded real Payment Platform/webhook E2E harness
- exact-body Payment Platform webhook verification before Discord message edits
- temporary filtered webhook registration and cleanup

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

The deterministic tests use no Discord token, Payment Platform credential,
PEPEW funds, or external network.

## Live transport acceptance

The dedicated Discord application transport was exercised on 2026-09-30.

Observed live path:

```text
Discord signed PING
  -> PONG
  -> /pepew-pay amount:0.1
  -> signed interaction accepted
  -> immediate private test-only acknowledgement
  -> ordinary bot channel message
  -> HTTPS PepewPay test button
```

No Payment Platform invoice, merchant API key, webhook endpoint, PEPEW funds,
wallet secret, or signing operation was used in that transport smoke.

The first live run exposed a harness-only shutdown issue after the ordinary bot
message had already been delivered successfully. The listener shutdown was
hardened in commit `4b508ee4e0b3dfe4af2e530db406e2e17d495c92` by closing idle
HTTP connections and bounding final socket cleanup. This did not change the
Discord transport or payment contract.

The application may appear offline in Discord because this adapter uses HTTP
Interactions instead of maintaining a Gateway/WebSocket session.

## Operator transport smoke

Required values:

```text
DISCORD_PUBLIC_KEY        # public
DISCORD_APPLICATION_ID    # public
DISCORD_GUILD_ID          # public test-server ID
DISCORD_BOT_TOKEN         # secret; server-side only
```

The transport listener defaults to:

```text
127.0.0.1:8789/pepew-discord-e2e/interactions
```

Expose only that path through a temporary HTTPS reverse proxy. Do not expose
port 8789 directly.

Start the listener:

```bash
cd integrations/discord

export DISCORD_PUBLIC_KEY="<application public key>"
read -rsp "Discord bot token: " DISCORD_BOT_TOKEN; echo
export DISCORD_BOT_TOKEN

npm run smoke:transport
```

Register/update the guild-scoped command in another shell:

```bash
cd integrations/discord

export DISCORD_APPLICATION_ID="<application id>"
export DISCORD_GUILD_ID="<test server id>"
read -rsp "Discord bot token: " DISCORD_BOT_TOKEN; echo
export DISCORD_BOT_TOKEN

npm run setup:test-command
```

Then run:

```text
/pepew-pay amount:0.1
```

After the smoke:

```bash
unset DISCORD_BOT_TOKEN
```

## Operator real payment/webhook E2E

The bounded operator harness is:

```text
scripts/payment-e2e.mjs
src/e2e.mjs
```

It uses one localhost HTTP server for two narrow paths:

```text
/pepew-discord-e2e/interactions
/pepew-discord-e2e/webhooks/pepew
```

The default listener remains `127.0.0.1:8789`. Expose only the two exact HTTPS
paths through the temporary reverse proxy; never expose port 8789 directly.

The E2E harness:

1. starts the localhost listener;
2. registers one temporary filtered Payment Platform webhook endpoint;
3. waits for one signed `/pepew-pay` interaction;
4. accepts only the configured small E2E amount;
5. immediately acknowledges the Discord interaction;
6. creates exactly one real Payment Platform invoice through the merchant SDK;
7. posts one ordinary Discord channel message with the real PepewPay capability
   URL;
8. verifies Payment Platform webhook HMAC against the exact raw request body;
9. ignores another payment, a merchant-reference mismatch, and stale/duplicate
   `payment_version` values;
10. edits the same Discord channel message for newer authoritative states;
11. waits for a terminal paid/expired state;
12. disables the temporary webhook endpoint during normal cleanup.

The temporary endpoint subscribes only to:

```text
payment.partial
payment.paid_unconfirmed
payment.paid_confirmed
payment.overpaid
payment.expired
```

Required values:

```text
DISCORD_PUBLIC_KEY
DISCORD_BOT_TOKEN
PEPEW_MERCHANT_API_KEY
PEPEW_RECEIVE_ADDRESS
PEPEW_PUBLIC_WEBHOOK_URL
```

Recommended bounded live values:

```text
PEPEW_PUBLIC_WEBHOOK_URL=https://pepepow.net/pepew-discord-e2e/webhooks/pepew
PEPEW_E2E_AMOUNT=0.1
PEPEW_CONFIRMATIONS=1
```

Enter secrets without putting them in shell history:

```bash
cd integrations/discord
npm test

export DISCORD_PUBLIC_KEY="<application public key>"
export PEPEW_RECEIVE_ADDRESS="<merchant receiving address>"
export PEPEW_PUBLIC_WEBHOOK_URL="https://pepepow.net/pepew-discord-e2e/webhooks/pepew"
export PEPEW_E2E_AMOUNT="0.1"
export PEPEW_CONFIRMATIONS="1"

read -rsp "Discord bot token: " DISCORD_BOT_TOKEN; echo
export DISCORD_BOT_TOKEN
read -rsp "PEPEW merchant API key: " PEPEW_MERCHANT_API_KEY; echo
export PEPEW_MERCHANT_API_KEY

npm run smoke:payment-e2e
```

When the harness is ready, run exactly once in the selected Discord test
channel:

```text
/pepew-pay amount:0.1
```

The bot should post one ordinary message containing a real PepewPay button.
Complete that payment through the integrated Wallet from a payer address
different from `PEPEW_RECEIVE_ADDRESS`.

Expected authoritative progression:

```text
paid_unconfirmed
  -> paid_confirmed
  -> same Discord message updated
  -> terminal state: paid
```

After the run:

```bash
unset DISCORD_BOT_TOKEN PEPEW_MERCHANT_API_KEY
unset PEPEW_RECEIVE_ADDRESS PEPEW_PUBLIC_WEBHOOK_URL
unset PEPEW_E2E_AMOUNT PEPEW_CONFIRMATIONS
```

The signed Discord interaction itself supplies the authenticated
`application_id` used for stable payment identity; the real-payment harness
does not require a second operator-supplied application ID. The one-time webhook
signing secret is returned by the Payment Platform and kept in process memory
only. Do not print or persist it.

If cleanup reports that temporary webhook disable failed, disable that endpoint
manually before ending the acceptance session.

## Production acceptance record

Live acceptance completed on 2026-10-01 using the dedicated Discord application
and the authoritative Payment Platform.

Observed path:

```text
Discord /pepew-pay amount:0.1
  -> exact-body Ed25519 verification
  -> immediate private acknowledgement
  -> real 0.1 PEPEW Payment Platform invoice
  -> ordinary Discord bot channel message + real PepewPay button
  -> integrated Wallet payment from a payer address different from the merchant receiving address
  -> signed Payment Platform webhook
  -> paid_unconfirmed
  -> paid_confirmed
  -> same Discord bot message updated to confirmed
```

The adapter remained merchant-side only. The server did not receive a mnemonic
or private key and did not perform transaction signing. The bot token, merchant
API key, and one-time webhook signing secret remained server-side only and were
not committed to GitHub or pasted into chat.

The first real-payment attempt exposed an operator-supplied application-ID
mismatch after the Discord request had already passed Ed25519 verification.
The E2E harness was simplified to use the authenticated `application_id`
contained in the verified Discord interaction, removing that redundant
operator-supplied identity check.

Closure record (2026-10-01): the retained payment evidence proves the real payment reached `paid_unconfirmed`, then `paid_confirmed`, and the same ordinary Discord bot message was updated to confirmed. The earlier chat did not preserve the harness's final terminal/cleanup lines, so cleanup was audited separately rather than inferred from the Discord UI.

Operator cleanup audit: **PASS**.

- [x] nothing remains listening on `127.0.0.1:8789`
- [x] the temporary Payment Platform webhook endpoint is disabled
- [x] the temporary Apache `ProxyPass` / `ProxyPassReverse` routes for `/pepew-discord-e2e/interactions` and `/pepew-discord-e2e/webhooks/pepew` are absent
- [x] `apache2ctl configtest` passed, Apache was reloaded, and normal `pepepow.net` service remained healthy
- [x] the Discord Developer Portal Interactions Endpoint no longer points at the deleted temporary route
- [x] temporary shell environment variables/secrets used by the harness were cleared

The cleanup audit closes I5.6 without changing the accepted Discord payment contract, Payment Platform authority, or the client-side signing boundary.


## Always-on production runtime

The bounded Phase I E2E harness remains available for acceptance testing, but
normal operation now uses `npm start` and remains online for repeated
`/pepew-pay amount:<amount>` commands.

The production runtime:

- verifies every Discord interaction against the exact raw request body;
- acknowledges the slash command before creating the payment;
- posts an ordinary channel message with the PepewPay button;
- supports multiple low-volume outstanding payments;
- persists only message-routing/restart state in a mode-0600 local JSON file;
- receives a permanent signed Payment Platform webhook endpoint;
- updates only on increasing `payment_version`;
- keeps Payment Platform as the authoritative payment ledger.

Deployment target and systemd/Apache configuration are documented in
`../../deploy/edison2/README.md`.
