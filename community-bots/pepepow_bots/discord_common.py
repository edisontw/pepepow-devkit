from __future__ import annotations

import logging
import os

import discord

logger = logging.getLogger(__name__)


def env_channel(name: str) -> int | None:
    value = (os.getenv(name) or "").strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        logger.warning("%s is not a valid Discord channel id", name)
        return None


async def set_channel_name(
    client: discord.Client, channel_id: int | None, name: str
) -> None:
    if channel_id is None:
        return
    channel = client.get_channel(channel_id)
    if channel is None:
        logger.warning(
            "Discord channel %s is not available to this bot", channel_id
        )
        return
    current = getattr(channel, "name", None)
    if current == name:
        return
    try:
        await channel.edit(
            name=name, reason="PEPEPOW Light API status update"
        )
        logger.info("Updated channel %s: %s", channel_id, name)
    except discord.HTTPException as exc:
        logger.warning(
            "Failed to update Discord channel %s: %s", channel_id, exc
        )
