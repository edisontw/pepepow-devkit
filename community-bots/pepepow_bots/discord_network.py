from __future__ import annotations

import logging
import os

import discord
from discord.ext import tasks
from dotenv import load_dotenv

from .discord_common import env_channel, set_channel_name
from .light_api import (
    LightAPI,
    decimal_or_none,
    format_hashrate,
    format_supply,
    int_or_none,
)

load_dotenv()
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

TOKEN = os.getenv("DISCORD_BOT_TOKEN2")
UPDATE_SECONDS = max(60, int(os.getenv("BOT_UPDATE_SECONDS", "600")))

HEIGHT_CHANNEL = env_channel("DISCORD_CHANNEL_ID3")
HASHRATE_CHANNEL = env_channel("DISCORD_CHANNEL_ID4")
SUPPLY_CHANNEL = env_channel("DISCORD_CHANNEL_ID5")

client = discord.Client(intents=discord.Intents.default())
api = LightAPI()


@tasks.loop(seconds=UPDATE_SECONDS)
async def refresh() -> None:
    try:
        payload = await api.network()
    except Exception as exc:
        logger.warning("Network refresh failed: %s", exc)
        return

    height = int_or_none(payload.get("height"))
    hashrate = decimal_or_none(payload.get("network_hashrate_hps"))
    supply = decimal_or_none(payload.get("money_supply"))

    height_text = f"{height:,}" if height is not None else "N/A"
    await set_channel_name(
        client, HEIGHT_CHANNEL, f"Height: {height_text}"
    )
    await set_channel_name(
        client, HASHRATE_CHANNEL, f"Hashrate: {format_hashrate(hashrate)}"
    )
    await set_channel_name(
        client, SUPPLY_CHANNEL, f"Supply: {format_supply(supply)}"
    )


@refresh.before_loop
async def before_refresh() -> None:
    await client.wait_until_ready()


@client.event
async def on_ready() -> None:
    logger.info("Discord network bot logged in as %s", client.user)
    if not refresh.is_running():
        refresh.start()


def main() -> None:
    if not TOKEN:
        raise SystemExit("DISCORD_BOT_TOKEN2 is not set")
    client.run(TOKEN, log_handler=None)


if __name__ == "__main__":
    main()
