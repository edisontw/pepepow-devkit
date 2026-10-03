# PEPEW Bot Runtime — edison2

Target:

```text
edison2
152.67.253.217
https://pepepow.net
```

This host runs the low-volume Telegram and Discord merchant/payment adapters.
Payment authority remains on `https://pay.pepepow.net`. edison2 stores only
bot routing/restart state and the server-side credentials required by the
adapters.

## Boundaries

- Do not move Payment Platform SQLite, watcher, webhook worker, mnemonic,
  private keys, or wallet signing to edison2.
- Telegram and Discord use separate scoped merchant credentials and separate receiving addresses.
- Bot tokens, merchant credentials, and webhook signing secrets stay in
  `/etc/pepew-bots/*.env`; never put them in GitHub, chat, or logs.
- Runtime listeners bind only to `127.0.0.1`.
- Apache exposes only the three required HTTPS callback paths.
- Local JSON files are message-routing/restart state, not payment authority.
- The first production release intentionally permits one outstanding payment per
  bot at a time. This matches current low usage and avoids overlapping invoices
  on one receiving address without adding an address-pool/derivation service.

## 1. Preflight

```bash
bash deploy/edison2/preflight.sh
```

Required:

- Node.js 20+
- npm
- Apache `proxy` and `proxy_http`
- localhost ports 8790 and 8791 free
- current `pepepow.net` HTTPS site healthy

Do not change the wallet node or existing website during preflight.

## 2. Production checkout and dependencies

Recommended checkout:

```bash
sudo mkdir -p /opt
cd /opt
sudo git clone https://github.com/edisontw/pepepow-devkit.git
cd /opt/pepepow-devkit

cd packages/pepewpay-merchant
sudo npm install --no-audit --no-fund
sudo npm run build

cd ../../integrations/telegram
sudo npm install --no-audit --no-fund
sudo npm test

cd ../discord
sudo npm install --no-audit --no-fund
sudo npm test
```

If `/opt/pepepow-devkit` already exists, use a clean `git pull` instead of
cloning over it.

## 3. Service user and protected configuration

```bash
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin pepew-bot 2>/dev/null || true
sudo install -d -o root -g pepew-bot -m 0750 /etc/pepew-bots
sudo install -d -o pepew-bot -g pepew-bot -m 0700 /var/lib/pepew-bots

sudo install -o root -g pepew-bot -m 0640 \
  deploy/edison2/telegram.env.example /etc/pepew-bots/telegram.env
sudo install -o root -g pepew-bot -m 0640 \
  deploy/edison2/discord.env.example /etc/pepew-bots/discord.env
```

Edit the two files locally on edison2. Do not paste their secret values into
ChatGPT or GitHub.

## 4. Create two scoped merchant credentials on VM-B

On VM-B use the existing Phase K operator helper. Create one merchant/credential
for Telegram and another for Discord:

```bash
cd /home/ubuntu/pepepow-electrumx-service
source backend/.venv/bin/activate

python3 backend/scripts/merchant_credential_admin.py create-merchant \
  --display-name "PEPEW Telegram Bot"

python3 backend/scripts/merchant_credential_admin.py create-credential \
  --merchant-id mrc_<telegram-id> \
  --label edison2-production \
  --secret-file /secure/path/telegram-api-key.txt

python3 backend/scripts/merchant_credential_admin.py create-merchant \
  --display-name "PEPEW Discord Bot"

python3 backend/scripts/merchant_credential_admin.py create-credential \
  --merchant-id mrc_<discord-id> \
  --label edison2-production \
  --secret-file /secure/path/discord-api-key.txt
```

The helper does not print generated Bearer secrets. Transfer each secret through
an approved private path into the matching edison2 env file, then delete the
temporary transfer copy. Never share one scoped credential or receiving address between both bots.

## 5. Apache HTTPS callback routes

Enable the existing proxy modules if necessary:

```bash
sudo a2enmod proxy proxy_http
```

Place the rules from `deploy/edison2/apache-pepew-bots.conf` inside the
existing `pepepow.net` HTTPS VirtualHost. Specific bot paths must appear before
any broader catch-all proxy rule.

```bash
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Do not expose TCP 8790 or 8791 in the host/cloud firewall.

Public paths:

```text
https://pepepow.net/pepew-telegram/webhooks/pepew
https://pepepow.net/pepew-discord/interactions
https://pepepow.net/pepew-discord/webhooks/pepew
```

Until the services start, Apache may return 503 on those narrow paths. That does
not affect the rest of `pepepow.net`.

## 6. Register permanent Payment Platform webhook endpoints

Register each endpoint once. The helper writes the one-time signing secret
straight into a protected env file and never prints it.

Telegram:

```bash
cd /opt/pepepow-devkit/integrations/telegram
sudo bash -c '
  set -a
  . /etc/pepew-bots/telegram.env
  set +a
  export PEPEW_PUBLIC_WEBHOOK_URL=https://pepepow.net/pepew-telegram/webhooks/pepew
  export PEPEW_WEBHOOK_ENV_FILE=/etc/pepew-bots/telegram-webhook.env
  npm run setup:webhook
  chown root:pepew-bot /etc/pepew-bots/telegram-webhook.env
  chmod 0640 /etc/pepew-bots/telegram-webhook.env
'
```

Discord:

```bash
cd /opt/pepepow-devkit/integrations/discord
sudo bash -c '
  set -a
  . /etc/pepew-bots/discord.env
  set +a
  export PEPEW_PUBLIC_WEBHOOK_URL=https://pepepow.net/pepew-discord/webhooks/pepew
  export PEPEW_WEBHOOK_ENV_FILE=/etc/pepew-bots/discord-webhook.env
  npm run setup:webhook
  chown root:pepew-bot /etc/pepew-bots/discord-webhook.env
  chmod 0640 /etc/pepew-bots/discord-webhook.env
'
```

The helpers refuse to overwrite an existing webhook env file. For future
rotation, deliberately disable the old endpoint before creating a replacement.

## 7. Install and start systemd services

```bash
cd /opt/pepepow-devkit

sudo install -o root -g root -m 0644 \
  deploy/edison2/pepew-telegram-bot.service \
  /etc/systemd/system/pepew-telegram-bot.service
sudo install -o root -g root -m 0644 \
  deploy/edison2/pepew-discord-bot.service \
  /etc/systemd/system/pepew-discord-bot.service

sudo systemctl daemon-reload
sudo systemctl enable pepew-telegram-bot pepew-discord-bot
sudo systemctl restart pepew-telegram-bot pepew-discord-bot
```

Verify without dumping environment variables:

```bash
sudo systemctl status pepew-telegram-bot --no-pager
sudo systemctl status pepew-discord-bot --no-pager
curl -fsS http://127.0.0.1:8790/healthz
curl -fsS http://127.0.0.1:8791/healthz
```

## 8. Discord application

Set the Discord Developer Portal Interactions Endpoint URL to:

```text
https://pepepow.net/pepew-discord/interactions
```

Register/update the guild command:

```bash
cd /opt/pepepow-devkit/integrations/discord
sudo -u pepew-bot bash -c '
  set -a
  . /etc/pepew-bots/discord.env
  set +a
  npm run setup:command
'
```

Expected command:

```text
/pepew-pay amount:10
```

## 9. Telegram bot

The production Telegram service uses long polling. The dedicated payment bot
must therefore have no Telegram webhook configured.

Supported private-chat command:

```text
/pay 10
```

The response contains a real PepewPay button. Payment status updates come only
from verified Payment Platform webhooks.

## 10. Small-value live acceptance

Use a small amount such as 0.1 PEPEW and pay from an address different from the
merchant receiving address.

Telegram:

```text
/pay 0.1
-> PepewPay button
-> integrated wallet payment
-> detected / waiting for confirmations
-> confirmed
```

Discord:

```text
/pepew-pay amount:0.1
-> ordinary channel payment message + PepewPay button
-> integrated wallet payment
-> same message updates to pending
-> same message updates to confirmed
```

Final checks:

```bash
sudo systemctl is-active pepew-telegram-bot pepew-discord-bot apache2
ss -ltnp | grep -E '127\.0\.0\.1:(8790|8791)'
sudo journalctl -u pepew-telegram-bot -n 50 --no-pager
sudo journalctl -u pepew-discord-bot -n 50 --no-pager
```

Logs must not contain bot tokens, merchant credentials, webhook signing
secrets, mnemonic phrases, private keys, or raw wallet signing material.
