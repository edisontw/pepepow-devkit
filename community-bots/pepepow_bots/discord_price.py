from __future__ import annotations

import logging
import os

import discord
from discord.ext import tasks
from dotenv import load_dotenv

from .discord_common import env_channel, set_channel_name
from .light_api import LightAPI, decimal_or_none, format_price, format_usd, source_decimal

load_dotenv()
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

TOKEN = os.getenv("DISCORD_BOT_TOKEN")
UPDATE_SECONDS = max(60, int(os.getenv("BOT_UPDATE_SECONDS", "600")))

PRICE_CHANNEL = env_channel("DISCORD_CHANNEL_ID")
NONKYC_VOLUME_CHANNEL = env_channel("DISCORD_CHANNEL_ID2")
NESTEX_VOLUME_CHANNEL = env_channel("DISCORD_CHANNEL_ID2_NESTEX")
NESTEX_PRICE_CHANNEL = env_channel("DISCORD_CHANNEL_NESTEXPRICE")
MARKET_CAP_CHANNEL = env_channel("DISCORD_CHANNEL_ID2_MC")
NONKYC_PRICE_CHANNEL = env_channel("DISCORD_CHANNEL_NONKYC_PRICE")

client = discord.Client(intents=discord.Intents.default())
api = LightAPI()


@tasks.loop(seconds=UPDATE_SECONDS)
async def refresh() -> None:
    try:
        payload = await api.market()
    except Exception as exc:
        logger.warning("Market refresh failed: %s", exc)
        return

    cmc_price = source_decimal(payload, "cmc", "price_usd")
    nonkyc_price = source_decimal(payload, "nonkyc", "price_usd")
    nonkyc_volume = source_decimal(payload, "nonkyc", "volume_24h_usd")
    nestex_price = source_decimal(payload, "nestex", "price_usd")
    nestex_volume = source_decimal(payload, "nestex", "volume_24h_usd")
    market_cap = decimal_or_none(payload.get("market_cap_onchain_usd"))

    await set_channel_name(
        client,
        PRICE_CHANNEL,
        f"Price (CMC) : ${format_price(cmc_price)}",
    )
    await set_channel_name(
        client,
        NONKYC_VOLUME_CHANNEL,
        f"NonKYC 24h Vol : ${format_usd(nonkyc_volume)}",
    )
    await set_channel_name(
        client,
        NONKYC_PRICE_CHANNEL,
        f"NonKYC : ${format_price(nonkyc_price)}",
    )
    await set_channel_name(
        client,
        NESTEX_PRICE_CHANNEL,
        f"NestEx : ${format_price(nestex_price)}",
    )
    await set_channel_name(
        client,
        NESTEX_VOLUME_CHANNEL,
        f"NestEx TradVol : ${format_usd(nestex_volume)}",
    )
    await set_channel_name(
        client,
        MARKET_CAP_CHANNEL,
        f"MarketCap (on-chain) : ${format_usd(market_cap)}",
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
