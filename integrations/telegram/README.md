# PEPEW Telegram Merchant Payment Adapter

Status: **I5.5 contract adapter baseline**

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
The project does not require a second public PEPEW wallet bot. A separate test
bot/token may still be used for Telegram transport acceptance.

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
or external network:

```bash
cd integrations/telegram
npm install
npm test
```

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

Telegram Bot API reference:

```text
https://core.telegram.org/bots/api
https://core.telegram.org/bots/features#the-test-environment
```

For the PEPEW merchant contract, see `docs/MERCHANT_QUICK_START.md` and
`docs/TESTING_AND_SANDBOX.md`.
