# PEPEW Telegram / Discord Bot Operations

Production host: edison2 / https://pepepow.net

Payment authority: https://pay.pepepow.net

Use this document for normal bot operation. Installation, upgrade, and recovery steps are in ../deploy/edison2/README.md.

## User commands

Telegram private chat, group, or supergroup:

~~~text
/pay <PEPEW-address> <amount>
~~~

Example:

~~~text
/pay PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb 0.1
~~~

The explicit `/pay@BotName ...` form is also accepted when it targets this bot. A command explicitly addressed to another bot is ignored. In a group, the payment address, amount, PepewPay button, and Payment Platform-driven status are visible to the group.

Discord:

~~~text
/pepew-pay address:<PEPEW-address> amount:<amount>
~~~

Example:

~~~text
/pepew-pay address:PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb amount:0.1
~~~

The receiving address is supplied per request and validated by the Payment Platform. The bot does not derive addresses and does not require wallet secrets.

Payment flow:

~~~text
command
  -> authoritative Payment API create/recovery
  -> PepewPay link
  -> client-side wallet payment/signing
  -> signed Payment Platform webhook
  -> bot message update
~~~

## Current limits

- amount must be positive with at most 8 decimal places;
- multiple outstanding payments may coexist when they use different receiving addresses;
- the Payment Platform rejects a new payment if the same receiving address already has an overlapping payment time window (`409 payment_address_in_use`);
- default expiry is 900 seconds;
- production confirmation policy is currently 1 confirmation;
- Telegram accepts `private`, `group`, and `supergroup` payment commands;
- Discord uses HTTP Interactions and may appear offline.

Address-window exclusivity is authoritative on the Payment Platform and applies across Telegram, Discord, WooCommerce, and other merchants. Bot-local runtime state is only for message routing; it is not the concurrency authority. Because payment timestamps use one-second resolution and late/reorg observations must remain unambiguous, an address is reusable only after the previous payment's `expires_at` boundary has passed.

## Security

The bot host must never receive or store:

~~~text
mnemonic
seed phrase
private key
wallet signing material
~~~

Server-side secrets:

~~~text
Telegram bot token
Discord bot token
scoped merchant credentials
Payment Platform webhook signing secrets
~~~

Do not print env files or secret values in logs, shell history, GitHub, or chat.

## Services and health

Services:

~~~text
pepew-telegram-bot.service
pepew-discord-bot.service
~~~

Check status:

~~~bash
systemctl is-active pepew-telegram-bot pepew-discord-bot apache2
systemctl is-enabled pepew-telegram-bot pepew-discord-bot
~~~

Health:

~~~bash
curl -fsS http://127.0.0.1:8790/healthz
echo
curl -fsS http://127.0.0.1:8791/healthz
echo
~~~

Listeners must remain loopback-only:

~~~bash
sudo ss -ltnp | grep -E '127\.0\.0\.1:(8790|8791)\b'
~~~

Public callback routes:

~~~text
https://pepepow.net/pepew-telegram/webhooks/pepew
https://pepepow.net/pepew-discord/interactions
https://pepepow.net/pepew-discord/webhooks/pepew
~~~

A GET to a callback path may return backend 404. A proxy 503 usually means Apache cannot reach the local runtime.

## Restart

Restart one service when possible:

~~~bash
sudo systemctl restart pepew-telegram-bot
sudo systemctl restart pepew-discord-bot
~~~

After restart, recheck its health endpoint.

Do not restart PEPEPOWd or the Payment Platform for a bot-only problem.

## Logs

Recent logs:

~~~bash
sudo journalctl -u pepew-telegram-bot -n 50 --no-pager
sudo journalctl -u pepew-discord-bot -n 50 --no-pager
~~~

Follow during diagnosis only:

~~~bash
sudo journalctl -u pepew-telegram-bot -f
sudo journalctl -u pepew-discord-bot -f
~~~

Logs must not contain bot tokens, merchant credentials, webhook signing secrets, mnemonic phrases, private keys, or signing material.

## Discord command registration

Production Interactions Endpoint:

~~~text
https://pepepow.net/pepew-discord/interactions
~~~

Register or update the guild command after any command-schema change:

~~~bash
cd /opt/pepepow-devkit/integrations/discord

sudo -u pepew-bot bash -c '
  set -a
  . /etc/pepew-bots/discord.env
  set +a
  npm run setup:command
'
~~~

The current schema requires both address and amount.

## Telegram transport

The production Telegram bot uses long polling and must not have a Telegram Bot API webhook configured.

A persistent getUpdates HTTP 409 normally indicates another poller or a conflicting webhook configuration. Diagnose the conflicting consumer before changing production configuration.

## Configuration

Runtime env files:

~~~text
/etc/pepew-bots/telegram.env
/etc/pepew-bots/telegram-webhook.env
/etc/pepew-bots/discord.env
/etc/pepew-bots/discord-webhook.env
~~~

Expected ownership/mode:

~~~text
root:pepew-bot
0640
~~~

Runtime routing state:

~~~text
/var/lib/pepew-bots/telegram-state.json
/var/lib/pepew-bots/discord-state.json
~~~

These JSON files contain restart/message-routing state only. Payment authority remains on the Payment Platform.

## Daily check

~~~bash
systemctl is-active pepew-telegram-bot pepew-discord-bot apache2
curl -fsS http://127.0.0.1:8790/healthz
echo
curl -fsS http://127.0.0.1:8791/healthz
echo
curl -fsSI https://pepepow.net/ | head
sudo ss -ltnp | grep -E '127\.0\.0\.1:(8790|8791)\b'
~~~

Production acceptance on 2026-10-03 confirmed the user-supplied-address command contract with successful real Telegram and Discord payments. Concurrency acceptance on 2026-10-04 confirmed two simultaneous Telegram payments on different addresses (`pending_payments=2`), same-address rejection in Telegram, and cross-bot same-address rejection in Discord. This verifies that concurrency is allowed by distinct address while address-window exclusivity remains authoritative on the Payment Platform. Use ../deploy/edison2/README.md for future upgrades or recovery.
