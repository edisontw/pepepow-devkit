# PEPEPOW Community Bots

Community Discord and Telegram status bots migrated from MN5.

## Data boundary

The v2 runtimes use **PEPEW Light** as their only public data API:

- `GET https://light.pepepow.net/api/price`
- `GET https://light.pepepow.net/api/network`

The bots do not directly query Explorer, NonKYC, NestEx, wallet RPC, or the old `api.pepepow.net` price endpoint.

## Runtimes

- `pepepow_bots.discord_price` — price, 24h volume, market-cap channel names
- `pepepow_bots.discord_network` — height, hashrate, supply channel names
- `pepepow_bots.telegram` — `/price`, `/network`, `/status`

Two Discord runtimes remain separate because the legacy installation uses two distinct Discord bot applications/tokens. They share the same codebase and Light API client.

The disabled legacy X/Twitter relay (`discord_bot3.service`) is intentionally not migrated.

## Improvements

- one shared Light API client
- async HTTP instead of blocking `requests`
- Discord channel names are changed only when values change
- reconnect-safe Discord task startup
- short dependency set instead of host-wide Python packages
- no raw upstream exception text in Telegram replies
- no wallet/node RPC access
- secrets live in a protected systemd EnvironmentFile

## Migrate MN5 environment

On MN5:

```bash
cd /path/to/pepepow-devkit/community-bots
python3 scripts/migrate_env.py   /home/ubuntu/discord_bot/.env   /tmp/pepepow-community-bots.env
```

Copy the generated file privately to edison2 and install it as:

```text
/etc/pepepow-community-bots/bots.env
```

Do not commit it.

## edison2 install

The existing DevKit checkout is `/opt/pepepow-devkit`.

```bash
cd /opt/pepepow-devkit
git pull --ff-only

cd community-bots
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -e .

sudo install -d -o root -g pepew-bot -m 0750 /etc/pepepow-community-bots
sudo install -o root -g pepew-bot -m 0640   /path/to/pepepow-community-bots.env   /etc/pepepow-community-bots/bots.env

sudo install -o root -g root -m 0644   systemd/pepepow-community-discord-price.service   /etc/systemd/system/
sudo install -o root -g root -m 0644   systemd/pepepow-community-discord-network.service   /etc/systemd/system/
sudo install -o root -g root -m 0644   systemd/pepepow-community-telegram.service   /etc/systemd/system/

sudo systemctl daemon-reload
```

Do not run the new Telegram service while MN5 `telegram_bot4.service` is still polling with the same bot token.

## Acceptance

Verify Light first:

```bash
curl -fsS https://light.pepepow.net/api/price
curl -fsS https://light.pepepow.net/api/network
```

Then start Discord on edison2:

```bash
sudo systemctl enable --now   pepepow-community-discord-price   pepepow-community-discord-network
```

After the Discord channel names update correctly, cut Telegram over quickly:

MN5:

```bash
sudo systemctl stop telegram_bot4.service
```

edison2:

```bash
sudo systemctl enable --now pepepow-community-telegram
```

Test `/price`, `/network`, and `/status`.

After acceptance, on MN5:

```bash
sudo systemctl disable --now   discord_bot.service   discord_bot2.service   telegram_bot4.service
```

Do not change `pepepowd` or any `pepepow-pool-*` service as part of this migration.
