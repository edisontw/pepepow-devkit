# PEPEW Discord Merchant Payment Adapter

Merchant-side Discord adapter for the PEPEW Payment Platform.

It uses Discord HTTP Interactions and ordinary bot channel messages. It is not a wallet; mnemonic/private keys and transaction signing remain client-side.

## Production command

~~~text
/pepew-pay address:<PEPEW-address> amount:<amount>
~~~

Example:

~~~text
/pepew-pay address:PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb amount:0.1
~~~

The receiving address comes from the signed interaction. The production runtime does not use a fixed PEPEW_RECEIVE_ADDRESS.

Flow:

~~~text
signed Discord interaction
  -> Ed25519 verification
  -> immediate acknowledgement
  -> stable hashed payment identity
  -> Payment API create/recovery
  -> ordinary channel message + PepewPay link
  -> client-side wallet payment
  -> signed Payment Platform webhook
  -> edit the same channel message
~~~

Payment Platform state is authoritative.

## Identity

Payment identity is derived from:

~~~text
application_id + channel_id + interaction_id
~~~

Raw Discord identifiers are hashed before they enter merchant_reference or Idempotency-Key. No Discord user ID is required for payment authority.

## Secrets

Server-side only:

~~~text
DISCORD_BOT_TOKEN
PEPEW_MERCHANT_API_KEY
PEPEW_WEBHOOK_SIGNING_SECRET
~~~

DISCORD_PUBLIC_KEY and DISCORD_APPLICATION_ID are public identifiers.

Do not put secrets in Payment URIs, checkout URLs, logs, GitHub, or chat.

## Test

Build the local merchant SDK first:

~~~bash
cd packages/pepewpay-merchant
npm install
npm run build

cd ../../integrations/discord
npm install
npm test
~~~

Deterministic tests require no Discord token, Payment Platform credential, or PEPEW funds.

## Command registration

The current command schema requires both address and amount.

~~~bash
cd integrations/discord

export DISCORD_APPLICATION_ID="<application id>"
export DISCORD_GUILD_ID="<guild id>"
read -rsp "Discord bot token: " DISCORD_BOT_TOKEN; echo
export DISCORD_BOT_TOKEN

npm run setup:command

unset DISCORD_BOT_TOKEN
~~~

Production Interactions Endpoint:

~~~text
https://pepepow.net/pepew-discord/interactions
~~~

Because this adapter uses HTTP Interactions rather than a Gateway/WebSocket session, the application may appear offline.

## Transport smoke

scripts/transport-smoke.mjs verifies signed PING/command transport and bot channel-message creation without creating a real Payment Platform payment.

The listener defaults to localhost. Expose only the exact temporary HTTPS interaction path while testing.

## Bounded payment E2E

scripts/payment-e2e.mjs is an operator acceptance harness. It:

- verifies Discord Ed25519 signatures against the exact raw body;
- creates one real Payment Platform payment;
- registers a temporary filtered Payment Platform webhook;
- verifies webhook HMAC before message updates;
- ignores stale/duplicate payment_version values;
- disables the temporary endpoint during normal cleanup.

This harness still uses PEPEW_RECEIVE_ADDRESS as an explicit test fixture. That variable is not part of the always-on production command contract.

Typical setup:

~~~bash
cd integrations/discord
npm test

export DISCORD_PUBLIC_KEY="<application public key>"
export PEPEW_RECEIVE_ADDRESS="<test receiving address>"
export PEPEW_PUBLIC_WEBHOOK_URL="https://<public-host>/pepew-discord-e2e/webhooks/pepew"
export PEPEW_E2E_AMOUNT="0.1"
export PEPEW_CONFIRMATIONS="1"

read -rsp "Discord bot token: " DISCORD_BOT_TOKEN; echo
export DISCORD_BOT_TOKEN
read -rsp "PEPEW merchant API key: " PEPEW_MERCHANT_API_KEY; echo
export PEPEW_MERCHANT_API_KEY

npm run smoke:payment-e2e
~~~

Keep the listener private and expose only the required HTTPS test paths. Never paste bot tokens, merchant credentials, webhook signing secrets, mnemonics, or private keys into chat or GitHub.

## Always-on runtime

Start with:

~~~bash
npm start
~~~

The runtime:

- verifies every interaction against the exact raw request body;
- requires address and amount in /pepew-pay;
- acknowledges before asynchronous payment creation;
- posts and later edits one ordinary channel message;
- permits one outstanding payment at a time in the initial low-volume release;
- stores only bounded routing/restart state locally;
- receives a permanent signed Payment Platform webhook;
- applies only increasing payment_version updates.

Deployment and systemd/Apache configuration: ../../deploy/edison2/README.md

Day-to-day operations: ../../docs/BOT_OPERATIONS.md
