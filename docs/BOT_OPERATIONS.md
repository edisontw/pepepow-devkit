# PEPEW Telegram / Discord Bot Operations Guide

Production status: **LIVE — accepted 2026-10-03**

Production host:

```text
edison2
https://pepepow.net
```

Payment authority remains on:

```text
https://pay.pepepow.net
```

This guide is for normal bot use and day-to-day operations. Full deployment and recovery steps remain in [../deploy/edison2/README.md](../deploy/edison2/README.md).

## 1. User commands

The current bot contract requires the user to supply the PEPEW receiving address
for every payment request. The always-on runtimes do not use a fixed
`PEPEW_RECEIVE_ADDRESS`.

### Telegram

Use the dedicated PEPEW payment bot in a **private chat**.

Command:

```text
/pay <address> <amount>
```

Example:

```text
/pay PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb 0.1
```

Expected flow:

```text
/pay <address> 0.1
  -> bot creates a PEPEW payment request for that address
  -> bot returns an Open PepewPay button
  -> payer opens PepewPay and completes payment in a PEPEW wallet
  -> bot message updates when payment is detected
  -> bot message updates again when the configured confirmation policy is satisfied
```

The Telegram production bot accepts private-chat payment commands only.

### Discord

Use the slash command in the configured Discord server:

```text
/pepew-pay address:<address> amount:<amount>
```

Example:

```text
/pepew-pay address:PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb amount:0.1
```

Expected flow:

```text
/pepew-pay address:<address> amount:0.1
  -> Discord acknowledges the signed interaction
  -> bot creates a payment for the supplied PEPEW address
  -> bot creates an ordinary channel payment message
  -> message includes an Open PepewPay button
  -> payer completes payment in a PEPEW wallet
  -> the same Discord message updates as authoritative payment state changes
  -> confirmed state is shown after the configured confirmation policy is satisfied
```

The Discord bot may appear offline because this integration uses Discord HTTP Interactions rather than a persistent Gateway/WebSocket connection.

## 2. Address/amount rules and initial production limits

Address:

- is supplied by the user for each payment request;
- is passed to the authoritative Payment Platform, which performs PEPEW address validation;
- is not derived by the bot and does not require a mnemonic or private key.

Amounts:

- must be positive;
- may contain up to 8 decimal places;
- are denominated in PEPEW.

Initial production policy:

- Telegram permits one outstanding payment at a time.
- Discord permits one outstanding payment at a time.
- Telegram and Discord still use different scoped merchant credentials, but neither runtime has a fixed receiving address.
- Current production payment expiry is 900 seconds (15 minutes).
- Current production confirmation policy is 1 confirmation.

If a payment is already in progress, a second request is rejected until the current payment reaches a terminal state or expires. This low-volume concurrency limit is retained independently of the receiving-address change.

Do not add address-pool, HD derivation, queue, Redis, PostgreSQL, or other concurrency infrastructure until real usage demonstrates the need.

## 3. Security boundary

The bots are merchant-side payment adapters, not wallets.

The server must never receive:

```text
mnemonic
seed phrase
private key
wallet signing material
```

Payment signing remains client-side in the payer's wallet.

Server-side secrets include:

```text
Telegram bot token
Discord bot token
scoped PEPEW merchant API credentials
Payment Platform webhook signing secrets
```

Do not print, paste, commit, or log those values.

## 4. Production services

Systemd services:

```text
pepew-telegram-bot.service
pepew-discord-bot.service
```

Check both:

```bash
sudo systemctl status pepew-telegram-bot --no-pager
sudo systemctl status pepew-discord-bot --no-pager
```

Compact active check:

```bash
systemctl is-active pepew-telegram-bot pepew-discord-bot
```

Expected:

```text
active
active
```

Boot enablement:

```bash
systemctl is-enabled pepew-telegram-bot pepew-discord-bot
```

Expected:

```text
enabled
enabled
```

## 5. Health checks

Telegram:

```bash
curl -fsS http://127.0.0.1:8790/healthz
```

Discord:

```bash
curl -fsS http://127.0.0.1:8791/healthz
```

Both should return JSON containing:

```text
"ok":true
```

Check listeners:

```bash
sudo ss -ltnp | grep -E '127\.0\.0\.1:(8790|8791)\b'
```

Required:

```text
127.0.0.1:8790
127.0.0.1:8791
```

They must not bind to:

```text
0.0.0.0:8790
0.0.0.0:8791
[::]:8790
[::]:8791
```

## 6. Safe restart

Restart Telegram only:

```bash
sudo systemctl restart pepew-telegram-bot
sudo systemctl status pepew-telegram-bot --no-pager
curl -fsS http://127.0.0.1:8790/healthz
```

Restart Discord only:

```bash
sudo systemctl restart pepew-discord-bot
sudo systemctl status pepew-discord-bot --no-pager
curl -fsS http://127.0.0.1:8791/healthz
```

Restart both only when necessary:

```bash
sudo systemctl restart pepew-telegram-bot pepew-discord-bot
```

Do not restart PEPEPOWd, Apache, or Payment Platform merely because one bot needs a restart.

## 7. Logs

Telegram:

```bash
sudo journalctl -u pepew-telegram-bot -n 50 --no-pager
```

Discord:

```bash
sudo journalctl -u pepew-discord-bot -n 50 --no-pager
```

Follow live logs only during diagnosis:

```bash
sudo journalctl -u pepew-telegram-bot -f
sudo journalctl -u pepew-discord-bot -f
```

Logs must never contain bot tokens, merchant credentials, webhook signing secrets, mnemonic phrases, private keys, or raw wallet signing material.

## 8. Apache callback routes

Production HTTPS callbacks:

```text
https://pepepow.net/pepew-telegram/webhooks/pepew
https://pepepow.net/pepew-discord/interactions
https://pepepow.net/pepew-discord/webhooks/pepew
```

The underlying Node listeners remain localhost-only.

Check Apache syntax:

```bash
sudo apache2ctl configtest
```

Expected:

```text
Syntax OK
```

Check the main site:

```bash
curl -fsSI https://pepepow.net/ | head
```

Expected: HTTP 200.

A normal GET to the exact callback paths may return 404 from the bot runtime. A 404 proves the request reached the backend; a 503 usually indicates the proxy could not reach the local runtime.

## 9. Discord application endpoint

Production Discord Interactions Endpoint URL:

```text
https://pepepow.net/pepew-discord/interactions
```

If the Discord application is replaced or reconfigured, this endpoint must pass Discord's signed PING validation.

Register/update the configured guild command:

```bash
cd /opt/pepepow-devkit/integrations/discord

sudo -u pepew-bot bash -c '
  set -a
  . /etc/pepew-bots/discord.env
  set +a
  npm run setup:command
'
```

Do not print the bot token.

## 10. Telegram transport

The Telegram production bot uses Bot API long polling and therefore must not have a Telegram Bot API webhook configured.

A persistent Telegram `getUpdates` conflict / HTTP 409 usually means another poller or Telegram webhook configuration is interfering.

Do not blindly delete or rotate production configuration; diagnose the conflicting consumer first.

## 11. Configuration locations

Runtime env files:

```text
/etc/pepew-bots/telegram.env
/etc/pepew-bots/telegram-webhook.env
/etc/pepew-bots/discord.env
/etc/pepew-bots/discord-webhook.env
```

Expected ownership/mode:

```text
root:pepew-bot
0640
```

Runtime routing state:

```text
/var/lib/pepew-bots/telegram-state.json
/var/lib/pepew-bots/discord-state.json
```

These JSON files are restart/message-routing state only. They are not authoritative payment accounting.

Never dump production env files during routine diagnostics.

## 12. Quick daily check

```bash
systemctl is-active pepew-telegram-bot pepew-discord-bot apache2
curl -fsS http://127.0.0.1:8790/healthz
echo
curl -fsS http://127.0.0.1:8791/healthz
echo
curl -fsSI https://pepepow.net/ | head
sudo ss -ltnp | grep -E '127\.0\.0\.1:(8790|8791)\b'
```

Expected:

- Telegram active;
- Discord active;
- Apache active;
- both health endpoints report `ok: true`;
- main site returns HTTP 200;
- ports 8790/8791 remain loopback-only.

## 13. Production acceptance baseline

Accepted on 2026-10-03:

- historical acceptance used the earlier fixed-address Telegram `/pay 0.1` flow -> confirmed -> bot message updated;
- historical acceptance used the earlier fixed-address Discord `/pepew-pay amount:0.1` flow -> confirmed -> same channel message updated;
- current GitHub contract corrects this by requiring a receiving address in every Telegram/Discord command; redeploy current `main` before using the new syntax in production;
- both services active/enabled;
- localhost-only listeners verified;
- Apache exact callback routes verified;
- permanent scoped Payment Platform webhooks registered;
- log secret checks passed;
- temporary credential-transfer and SSH handoff artifacts removed.

Use this baseline when diagnosing future regressions.
