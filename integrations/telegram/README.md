# PEPEW Telegram Merchant Payment Adapter

Status: **I5.5 complete — production Telegram payment/webhook E2E accepted 2026-09-30**

This directory tests the next Phase I merchant/payment adapter after WooCommerce.

This is **not another PEPEW wallet bot** and it does not replace the existing
Telegram wallet/Mini App in `edisontw/pepepow-wallet-suite`.

The domain split is intentional:

- `pepepow-wallet-suite` Telegram Bot / Mini App is payer-side wallet UX:
  balance, receive, send, wallet handoff, and client-side signing. Mnemonic and
  private keys remain on the user's device.
- this adapter is merchant-side payment acceptance: create a Payment Platform
  invoice, return a PepewPay checkout link in Telegram, consume authoritative
  signed payment events, and update merchant/chat payment state.
- the adapter contains no mnemonic, private-key, derivation, UTXO-selection, or
  transaction-signing logic.
- PepewPay may hand a payer into the existing PEPEW wallet/Mini App, so the two
  systems are complementary rather than competing implementations.

A production merchant may embed this adapter pattern in its own Telegram bot.
The project does not require replacing the existing PEPEW wallet bot. The
transport layer supports both Telegram's dedicated test environment and a
separate normal production-environment merchant/payment bot.

The first increment is deliberately network-free. It proves the Telegram-shaped
merchant contract before any bot token or production merchant secret is used.

## Scope

The adapter:

- derives a stable PEPEW merchant reference and Idempotency-Key from
  `bot_id + chat_id + message_id`
- hashes Telegram identifiers before putting business identity into the Payment
  Platform, so raw chat/user identifiers are not stored in `merchant_reference`
- creates payments only through the server-side
  `@pepepow/pepewpay-merchant` client
- returns a Telegram `sendMessage` payload with an HTTPS PepewPay URL button
- recovers uncertain create outcomes by exact merchant reference
- applies payment updates only by increasing `payment_version`
- does not treat an unconfirmed `overpaid` state as fulfillment-ready; the
  requested amount must be covered by `policy_confirmed_sats`
- contains no wallet mnemonic/private-key/signing logic

## Secret boundary

Server-side only:

```text
TELEGRAM_BOT_TOKEN
PEPEW_MERCHANT_API_KEY
PEPEW_WEBHOOK_SIGNING_SECRET
```

The Telegram chat may receive only the intended PepewPay checkout capability
URL and human-facing payment status.

Do not put raw Telegram user profile data, bot tokens, merchant credentials,
wallet secrets, or private infrastructure details into `merchant_reference`,
Payment URI fields, or chat-visible URLs.

## Test

The local test uses no Telegram token, PEPEW funds, Payment Platform credential,
or external network.

On a fresh clone, build the local merchant SDK first because the Telegram
integration imports its compiled `dist/index.js`:

```bash
cd packages/pepewpay-merchant
npm install
npm run build

cd ../../integrations/telegram
npm install
npm test
```

After the merchant SDK has already been built, subsequent Telegram test runs only
need:

```bash
cd integrations/telegram
npm test
```

## Telegram Test Environment transport smoke

The first external increment is an operator-only transport smoke. It uses only a
dedicated Telegram **test-environment** bot token and never calls the Payment
Platform.

Implementation:

```text
src/transport.mjs
scripts/transport-smoke.mjs
tests/transport.test.mjs
```

The smoke is intentionally bounded:

1. authenticate the dedicated test bot with `getMe`
2. advance past the latest queued update, then wait for one fresh private-chat
   message
3. reply once with a merchant payment-style test message and an HTTPS
   `Pay with PEPEW` inline button pointing at `https://pay.pepepow.net/`
4. exit

It does **not** create a Payment API intent, register/delete a Telegram webhook,
process a PEPEW webhook, send funds, or touch wallet signing.

The transport-smoke script calls only Telegram Test Bot API methods `getMe`, `getUpdates`,
and `sendMessage`. The later payment E2E harness additionally uses `editMessageText` only after a verified Payment Platform webhook. It refuses group/supergroup updates and does not print raw
Telegram chat/user identifiers. The bot token is accepted from
`TELEGRAM_BOT_TOKEN` only; there is no token command-line argument.

Create the bot inside Telegram's dedicated test environment, start the script,
wait until it says it is waiting for a fresh private message, then send one
message to that test bot.

To enter the token without echoing it or placing the token value in shell
history:

```bash
cd integrations/telegram
npm install
read -rsp "Telegram test bot token: " TELEGRAM_BOT_TOKEN; echo
export TELEGRAM_BOT_TOKEN
npm run smoke:transport
unset TELEGRAM_BOT_TOKEN
```

Do not paste the token into chat, an issue, CI variables for normal contract
tests, or a repository file. Use a clean dedicated test bot; the smoke does not
automatically remove an existing Telegram webhook.

## Live test sequence

After the deterministic contract tests pass, use Telegram's dedicated Bot API
test environment before attaching the adapter to any production merchant bot.

The live test should be staged in two increments:

1. Bot transport smoke: authenticate the test bot, receive one update, and send
   one message with a PepewPay HTTPS inline URL button. Do not create or pay a
   PEPEW invoice yet.
2. Payment E2E: create a small payment through the merchant backend, pay from a
   different PEPEW address than the merchant receiving address, process signed
   Payment Platform webhooks, and update the Telegram message only after the
   configured confirmation policy is satisfied.

## Operator payment/webhook E2E

The bounded operator harness is:

```text
scripts/payment-e2e.mjs
src/e2e.mjs
```

It starts a localhost webhook receiver, registers one temporary HTTPS webhook
endpoint with the Payment Platform, waits for one fresh private message in the
Telegram Test Environment, creates one real PEPEW payment, sends the PepewPay
button, verifies exact-body webhook signatures, applies only increasing
`payment_version`, and updates that Telegram message with `editMessageText`.

The temporary webhook endpoint subscribes only to:

```text
payment.partial
payment.paid_unconfirmed
payment.paid_confirmed
payment.overpaid
payment.expired
```

The endpoint is disabled when the test reaches a terminal state, times out, or
the harness exits through its normal cleanup path. The one-time signing secret
is kept in process memory only and is never written to the repository.

A public HTTPS route is required to reach the local listener (default `127.0.0.1:8788`). This may be a temporary HTTPS tunnel or a narrow reverse-proxy route on a suitable test host. Keep port 8788 bound to localhost and expose only the callback path. Set the full public callback URL ending in `/webhooks/pepew`.

Enter secrets without putting their values in shell history:

```bash
cd integrations/telegram
npm install
npm test

read -rsp "Telegram test bot token: " TELEGRAM_BOT_TOKEN; echo
export TELEGRAM_BOT_TOKEN
read -rsp "PEPEW merchant API key: " PEPEW_MERCHANT_API_KEY; echo
export PEPEW_MERCHANT_API_KEY

export PEPEW_RECEIVE_ADDRESS="<merchant receiving address>"
export PEPEW_PUBLIC_WEBHOOK_URL="https://<public-tunnel-host>/webhooks/pepew"
export PEPEW_E2E_AMOUNT="0.1"
export PEPEW_CONFIRMATIONS="1"

npm run smoke:payment-e2e

unset TELEGRAM_BOT_TOKEN PEPEW_MERCHANT_API_KEY
unset PEPEW_RECEIVE_ADDRESS PEPEW_PUBLIC_WEBHOOK_URL
unset PEPEW_E2E_AMOUNT PEPEW_CONFIRMATIONS
```

When the harness says it is waiting for a fresh private message, send one message
to the dedicated test bot. It will create exactly one payment and return a real
PepewPay button. Complete that payment from a PEPEW payer address that is
different from `PEPEW_RECEIVE_ADDRESS`. Wallet mnemonic/private key and signing
remain entirely client-side.

Do not paste the Telegram token, merchant API key, temporary webhook signing
secret, mnemonic, or private key into chat or GitHub.

Telegram Bot API reference:

```text
https://core.telegram.org/bots/api
https://core.telegram.org/bots/features#the-test-environment
```

For the PEPEW merchant contract, see `docs/MERCHANT_QUICK_START.md` and
`docs/TESTING_AND_SANDBOX.md`.



Production acceptance record (2026-09-30):

- dedicated normal Telegram merchant/payment bot authenticated through `TELEGRAM_API_ENV=production`
- real 0.1 PEPEW invoice created through the authoritative Payment Platform
- payer address differed from the merchant receiving address
- temporary HTTPS Apache reverse-proxy callback reached the localhost receiver at `127.0.0.1:8788`
- exact-body signed webhook advanced the payment through `paid_unconfirmed` and `paid_confirmed`
- Telegram message update completed and the harness reached terminal state `paid`
- temporary Payment Platform webhook endpoint was disabled during cleanup
- no bot token, merchant API key, webhook signing secret, mnemonic, or private key was stored in GitHub/chat

## Normal Telegram production-environment bot

A newly created merchant/payment bot may be tested directly without replacing or
reconfiguring the existing PEPEW Wallet Bot. Use a dedicated bot that has no
Telegram webhook configured while this bounded operator harness uses
`getUpdates`.

Set:

```bash
export TELEGRAM_API_ENV=production
```

Production mode calls the normal Bot API path:

```text
https://api.telegram.org/bot<TOKEN>/METHOD
```

Test mode remains available and uses:

```text
https://api.telegram.org/bot<TOKEN>/test/METHOD
```

For a normal BotFather-created merchant/payment bot:

```bash
cd integrations/telegram
npm install
npm test

export TELEGRAM_API_ENV=production
read -rsp "Telegram bot token: " TELEGRAM_BOT_TOKEN; echo
export TELEGRAM_BOT_TOKEN

npm run smoke:transport

unset TELEGRAM_BOT_TOKEN TELEGRAM_API_ENV
```

Do not borrow the existing Wallet Bot for this harness because its Telegram
webhook belongs to the Wallet API control plane. The dedicated payment bot keeps
the two roles isolated.

If a complete bot token is ever disclosed outside trusted secret storage, revoke
it in BotFather and replace it before continuing.


## Always-on production runtime

The bounded Phase I E2E harness remains available for acceptance testing, but
normal operation now uses `npm start` and does not exit after one payment.

The production runtime:

- accepts private-chat `/pay <amount>`;
- uses Telegram production Bot API long polling;
- intentionally allows only one outstanding payment at a time for the first low-volume production release;
- persists only message-routing/restart state in a mode-0600 local JSON file;
- receives a permanent signed Payment Platform webhook endpoint;
- applies only increasing `payment_version` updates;
- keeps Payment Platform as the authoritative payment ledger.

Deployment target and systemd/Apache configuration are documented in
`../../deploy/edison2/README.md`.
