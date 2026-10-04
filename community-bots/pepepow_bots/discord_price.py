from __future__ import annotations

import asyncio
import logging
import os

import discord
from discord.ext import tasks
from dotenv import load_dotenv

from .discord_common import env_channel, set_channel_name
from .light_api import (
    LightAPI,
    decimal_or_none,
    format_price,
    format_usd,
    price_usdt,
    volume_24h_usd,
)

load_dotenv()
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

TOKEN = os.getenv("DISCORD_BOT_TOKEN")
UPDATE_SECONDS = max(60, int(os.getenv("BOT_UPDATE_SECONDS", "600")))

PRICE_CHANNEL = env_channel("DISCORD_CHANNEL_ID")
VOLUME_CHANNEL = env_channel("DISCORD_CHANNEL_ID2")
MARKET_CAP_CHANNEL = env_channel("DISCORD_CHANNEL_ID2_MC")
NONKYC_PRICE_CHANNEL = env_channel("DISCORD_CHANNEL_NONKYC_PRICE")
LEGACY_NESTEX_PRICE_CHANNEL = env_channel("DISCORD_CHANNEL_NESTEXPRICE")
LEGACY_NESTEX_VOLUME_CHANNEL = env_channel("DISCORD_CHANNEL_ID2_NESTEX")

client = discord.Client(intents=discord.Intents.default())
api = LightAPI()


@tasks.loop(seconds=UPDATE_SECONDS)
async def refresh() -> None:
    results = await asyncio.gather(
        api.price(), api.network(), return_exceptions=True
    )
    price_payload = None if isinstance(results[0], Exception) else results[0]
    network_payload = None if isinstance(results[1], Exception) else results[1]

    if isinstance(results[0], Exception):
        logger.warning("Price refresh failed: %s", results[0])
    if isinstance(results[1], Exception):
        logger.warning("Network refresh failed: %s", results[1])

    p = price_usdt(price_payload or {})
    volume = volume_24h_usd(price_payload or {})
    market_cap = decimal_or_none(
        (network_payload or {}).get("market_cap_usdt")
    )

    await set_channel_name(
        client, PRICE_CHANNEL, f"Price: ${format_price(p)}"
    )
    await set_channel_name(
        client, NONKYC_PRICE_CHANNEL, f"NonKYC: ${format_price(p)}"
    )
    await set_channel_name(
        client, VOLUME_CHANNEL, f"24h Vol: ${format_usd(volume)}"
    )
    await set_channel_name(
        client,
        MARKET_CAP_CHANNEL,
        f"MarketCap: ${format_usd(market_cap)}",
    )

    # v2 intentionally uses only PEPEW Light public APIs. Mark old
    # NestEx-only channels instead of leaving stale values behind.
    await set_channel_name(
        client, LEGACY_NESTEX_PRICE_CHANNEL, "NestEx: retired"
    )
    await set_channel_name(
        client, LEGACY_NESTEX_VOLUME_CHANNEL, "NestEx Vol: retired"
    )


@refresh.before_loop
async def before_refresh() -> None:
    await client.wait_until_ready()


@client.event
async def on_ready() -> None:
    logger.info("Discord price bot logged in as %s", client.user)
    if not refresh.is_running():
        refresh.start()


def main() -> None:
    if not TOKEN:
        raise SystemExit("DISCORD_BOT_TOKEN is not set")
    client.run(TOKEN, log_handler=None)


if __name__ == "__main__":
    main()
