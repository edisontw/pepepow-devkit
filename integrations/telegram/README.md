# PEPEW Telegram Merchant Payment Adapter

Merchant-side Telegram adapter for the PEPEW Payment Platform.

It is not a wallet. Mnemonic/private keys, UTXO selection, and transaction signing remain client-side.

## Production command

Private chat:

~~~text
/pay <PEPEW-address> <amount>
~~~

Group or supergroup:

~~~text
/pay <PEPEW-address> <amount>
~~~

The explicit `/pay@BotName ...` form is also accepted when it targets this bot; commands explicitly addressed to another bot are ignored.

Example:

~~~text
/pay PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb 0.1
~~~

The production runtime takes the receiving address from each command. It does not use a fixed PEPEW_RECEIVE_ADDRESS.

The payment request is posted publicly in the originating chat and shows the receiving address, exact amount, PepewPay button, and current Payment Platform-driven status.

Flow:

~~~text
Telegram command
  -> stable hashed merchant identity
  -> Payment API create/recovery
  -> PepewPay link
  -> client-side wallet payment
  -> signed Payment Platform webhook
  -> edit Telegram payment message
~~~

Payment Platform state is authoritative.

## Identity and privacy

Payment identity is derived from:

~~~text
bot_id + chat_id + message_id
~~~

Raw Telegram identifiers are hashed before they enter merchant_reference or Idempotency-Key.

The adapter does not need wallet secrets or raw Telegram profile data for payment authority.

## Secrets

Server-side only:

~~~text
TELEGRAM_BOT_TOKEN
PEPEW_MERCHANT_API_KEY
PEPEW_WEBHOOK_SIGNING_SECRET
~~~

Do not put secrets in Payment URIs, checkout URLs, logs, GitHub, or chat.

## Test

Build the local merchant SDK first:

~~~bash
cd packages/pepewpay-merchant
npm install
npm run build

cd ../../integrations/telegram
npm install
npm test
~~~

Deterministic tests require no Telegram token, Payment Platform credential, or PEPEW funds.

## Transport smoke

scripts/transport-smoke.mjs verifies Telegram Bot API transport without creating a real payment.

For a normal BotFather-created test bot:

~~~bash
cd integrations/telegram

export TELEGRAM_API_ENV=production
read -rsp "Telegram bot token: " TELEGRAM_BOT_TOKEN; echo
export TELEGRAM_BOT_TOKEN

npm run smoke:transport

unset TELEGRAM_BOT_TOKEN TELEGRAM_API_ENV
~~~

The smoke uses getMe/getUpdates/sendMessage only. Use a dedicated bot without a Telegram webhook while long polling is active.

## Bounded payment E2E

scripts/payment-e2e.mjs is an operator acceptance harness. It:

- creates one real Payment Platform payment;
- registers a temporary filtered webhook endpoint;
- verifies exact-body webhook signatures;
- updates the Telegram message only for newer payment_version values;
- disables the temporary endpoint during normal cleanup.

This harness still uses PEPEW_RECEIVE_ADDRESS as an explicit test fixture. That variable is not part of the always-on production command contract.

Typical setup:

~~~bash
cd integrations/telegram
npm test

read -rsp "Telegram bot token: " TELEGRAM_BOT_TOKEN; echo
export TELEGRAM_BOT_TOKEN
read -rsp "PEPEW merchant API key: " PEPEW_MERCHANT_API_KEY; echo
export PEPEW_MERCHANT_API_KEY

export PEPEW_RECEIVE_ADDRESS="<test receiving address>"
export PEPEW_PUBLIC_WEBHOOK_URL="https://<public-host>/webhooks/pepew"
export PEPEW_E2E_AMOUNT="0.1"
export PEPEW_CONFIRMATIONS="1"

npm run smoke:payment-e2e
~~~

Keep the local listener private and expose only the required HTTPS callback path. Never paste bot tokens, merchant credentials, webhook signing secrets, mnemonics, or private keys into chat or GitHub.

## Always-on runtime

Start with:

~~~bash
npm start
~~~

The runtime:

- uses Telegram production Bot API long polling;
- accepts `/pay <address> <amount>` in private chats, groups, and supergroups;
- accepts `/pay@BotName <address> <amount>` only when the mention targets this bot;
- permits one outstanding payment globally per bot at a time in the initial low-volume release, across all chats;
- stores only bounded routing/restart state locally;
- receives a permanent signed Payment Platform webhook;
- applies only increasing payment_version updates.

Deployment and systemd/Apache configuration: ../../deploy/edison2/README.md

Day-to-day operations: ../../docs/BOT_OPERATIONS.md
