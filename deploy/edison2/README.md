# PEPEW Bot Runtime — edison2

Target:

~~~text
edison2
https://pepepow.net
~~~

This host runs the low-volume Telegram and Discord payment adapters. Payment authority remains on https://pay.pepepow.net.

Current production status: the user-supplied receiving-address contract is deployed on edison2; Telegram and Discord real-payment acceptance passed on 2026-10-03.

Day-to-day checks are in ../../docs/BOT_OPERATIONS.md.

## Boundaries

- Payment Platform SQLite, watcher, and webhook worker stay off edison2.
- Wallet mnemonic/private keys/signing stay client-side.
- Telegram and Discord use separate scoped merchant credentials.
- The receiving address is supplied by each payment command; production runtime env files do not need PEPEW_RECEIVE_ADDRESS.
- Bot listeners bind only to 127.0.0.1.
- Apache exposes only the required HTTPS callback paths.
- Local JSON state is routing/restart state, not payment authority.
- One outstanding payment per bot is the initial low-volume concurrency limit.

## Upgrade an existing installation

For an existing edison2 deployment:

~~~bash
cd /opt/pepepow-devkit
sudo git pull --ff-only

cd packages/pepewpay-merchant
sudo npm install --no-audit --no-fund
sudo npm run build

cd ../../integrations/telegram
sudo npm install --no-audit --no-fund
sudo npm test

cd ../discord
sudo npm install --no-audit --no-fund
sudo npm test
~~~

Remove the obsolete fixed receive-address setting if present:

~~~bash
sudo sed -i '/^PEPEW_RECEIVE_ADDRESS=/d'   /etc/pepew-bots/telegram.env   /etc/pepew-bots/discord.env
~~~

After the 33c29b9 command-contract change, re-register the Discord command:

~~~bash
cd /opt/pepepow-devkit/integrations/discord

sudo -u pepew-bot bash -c '
  set -a
  . /etc/pepew-bots/discord.env
  set +a
  npm run setup:command
'
~~~

Restart and verify:

~~~bash
sudo systemctl restart pepew-telegram-bot pepew-discord-bot
curl -fsS http://127.0.0.1:8790/healthz
curl -fsS http://127.0.0.1:8791/healthz
~~~

Existing scoped merchant credentials and permanent Payment Platform webhook endpoints do not need to be recreated for this upgrade.

## Fresh installation

### 1. Preflight

~~~bash
bash deploy/edison2/preflight.sh
~~~

Required:

- Node.js 20+
- npm
- Apache proxy/proxy_http
- localhost ports 8790 and 8791 free
- https://pepepow.net healthy

### 2. Checkout and test

~~~bash
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
~~~

### 3. Service account and env files

~~~bash
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin pepew-bot 2>/dev/null || true
sudo install -d -o root -g pepew-bot -m 0750 /etc/pepew-bots
sudo install -d -o pepew-bot -g pepew-bot -m 0700 /var/lib/pepew-bots

sudo install -o root -g pepew-bot -m 0640   deploy/edison2/telegram.env.example /etc/pepew-bots/telegram.env

sudo install -o root -g pepew-bot -m 0640   deploy/edison2/discord.env.example /etc/pepew-bots/discord.env
~~~

Edit both env files locally. Do not expose secret values.

### 4. Scoped merchant credentials

On VM-B, create one merchant credential for each bot:

~~~bash
cd /home/ubuntu/pepepow-electrumx-service
source backend/.venv/bin/activate

python3 backend/scripts/merchant_credential_admin.py create-merchant   --display-name "PEPEW Telegram Bot"

python3 backend/scripts/merchant_credential_admin.py create-credential   --merchant-id mrc_<telegram-id>   --label edison2-production   --secret-file /secure/path/telegram-api-key.txt

python3 backend/scripts/merchant_credential_admin.py create-merchant   --display-name "PEPEW Discord Bot"

python3 backend/scripts/merchant_credential_admin.py create-credential   --merchant-id mrc_<discord-id>   --label edison2-production   --secret-file /secure/path/discord-api-key.txt
~~~

Transfer each credential through a private path into the matching edison2 env file, then delete the temporary copy. Do not share one credential between both bots.

### 5. Apache callbacks

Enable proxy modules if needed:

~~~bash
sudo a2enmod proxy proxy_http
~~~

Add deploy/edison2/apache-pepew-bots.conf rules to the existing pepepow.net HTTPS VirtualHost, then:

~~~bash
sudo apache2ctl configtest
sudo systemctl reload apache2
~~~

Public callback paths:

~~~text
https://pepepow.net/pepew-telegram/webhooks/pepew
https://pepepow.net/pepew-discord/interactions
https://pepepow.net/pepew-discord/webhooks/pepew
~~~

Do not expose TCP 8790 or 8791 publicly.

### 6. Permanent Payment Platform webhooks

Register each endpoint once. The helper writes the one-time signing secret directly into a protected env file.

Telegram:

~~~bash
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
~~~

Discord:

~~~bash
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
~~~

Do not overwrite an existing webhook env file. Rotate deliberately by disabling the old endpoint before creating a replacement.

### 7. Install services

~~~bash
cd /opt/pepepow-devkit

sudo install -o root -g root -m 0644   deploy/edison2/pepew-telegram-bot.service   /etc/systemd/system/pepew-telegram-bot.service

sudo install -o root -g root -m 0644   deploy/edison2/pepew-discord-bot.service   /etc/systemd/system/pepew-discord-bot.service

sudo systemctl daemon-reload
sudo systemctl enable pepew-telegram-bot pepew-discord-bot
sudo systemctl restart pepew-telegram-bot pepew-discord-bot
~~~

Verify:

~~~bash
systemctl is-active pepew-telegram-bot pepew-discord-bot
curl -fsS http://127.0.0.1:8790/healthz
curl -fsS http://127.0.0.1:8791/healthz
sudo ss -ltnp | grep -E '127\.0\.0\.1:(8790|8791)\b'
~~~

### 8. Discord application

Set the Interactions Endpoint URL to:

~~~text
https://pepepow.net/pepew-discord/interactions
~~~

Register/update the guild command:

~~~bash
cd /opt/pepepow-devkit/integrations/discord

sudo -u pepew-bot bash -c '
  set -a
  . /etc/pepew-bots/discord.env
  set +a
  npm run setup:command
'
~~~

Current command:

~~~text
/pepew-pay address:<PEPEW-address> amount:<amount>
~~~

### 9. Telegram bot

The production bot uses long polling and must not have a Telegram Bot API webhook configured.

Private-chat, group, and supergroup command:

~~~text
/pay <PEPEW-address> <amount>
~~~

The explicit `/pay@BotName ...` form is also accepted when it targets this bot. The initial group-capable release still permits only one outstanding Telegram payment globally across all chats.

## Small-value acceptance

Use a small amount and a valid receiving address.

Expected flow for both adapters:

~~~text
command
  -> PepewPay button
  -> client-side wallet payment
  -> detected / waiting for confirmations
  -> confirmed message update
~~~

Final checks:

~~~bash
systemctl is-active pepew-telegram-bot pepew-discord-bot apache2
curl -fsSI https://pepepow.net/ | head
sudo journalctl -u pepew-telegram-bot -n 50 --no-pager
sudo journalctl -u pepew-discord-bot -n 50 --no-pager
~~~

Logs must not contain bot tokens, merchant credentials, webhook signing secrets, mnemonic phrases, private keys, or signing material.
