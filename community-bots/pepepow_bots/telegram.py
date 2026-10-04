from __future__ import annotations

import asyncio
import html
import logging
import os

from dotenv import load_dotenv
from telegram import Update
from telegram.constants import ChatAction, ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

from .light_api import (
    LightAPI,
    decimal_or_none,
    format_hashrate,
    format_price,
    format_supply,
    format_usd,
    int_or_none,
    price_usdt,
    volume_24h_usd,
)

load_dotenv()
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

TOKEN = os.getenv("TELEGRAM_BOT4_TOKEN")
api = LightAPI()


async def start_cmd(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    if update.message is None:
        return
    await update.message.reply_text(
        "<b>PEPEPOW Bot</b>\n\n"
        "/price — PEPEW market summary\n"
        "/network — PEPEPOW network summary\n"
        "/status — PEPEW Light API status",
        parse_mode=ParseMode.HTML,
    )


async def _typing(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    if update.effective_chat is not None:
        await context.bot.send_chat_action(
            chat_id=update.effective_chat.id,
            action=ChatAction.TYPING,
        )


async def price_cmd(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    if update.message is None:
        return
    await _typing(update, context)
    price_result, network_result = await asyncio.gather(
        api.price(), api.network(), return_exceptions=True
    )

    if isinstance(price_result, Exception):
        logger.warning("Telegram price request failed: %s", price_result)
        await update.message.reply_text(
            "PEPEW price data is temporarily unavailable."
        )
        return

    p = price_usdt(price_result)
    volume = volume_24h_usd(price_result)
    source = html.escape(
        str(price_result.get("source") or "PEPEW Light")
    )
    status = html.escape(str(price_result.get("status") or "unknown"))

    lines = [
        "<b>PEPEW Market</b>",
        f"Price: <code>${format_price(p)}</code> USDT",
        f"24h volume: <code>${format_usd(volume)}</code>",
        f"Source: {source} via PEPEW Light",
    ]
    if status == "stale":
        lines.append("Data status: stale cache")

    if not isinstance(network_result, Exception):
        market_cap = decimal_or_none(
            network_result.get("market_cap_usdt")
        )
        if market_cap is not None:
            lines.append(
                f"On-chain market cap: "
                f"<code>${format_usd(market_cap)}</code>"
            )

    await update.message.reply_text(
        "\n".join(lines), parse_mode=ParseMode.HTML
    )


async def network_cmd(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    if update.message is None:
        return
    await _typing(update, context)
    try:
        payload = await api.network()
    except Exception as exc:
        logger.warning("Telegram network request failed: %s", exc)
        await update.message.reply_text(
            "PEPEPOW network data is temporarily unavailable."
        )
        return

    height = int_or_none(payload.get("height"))
    hashrate = decimal_or_none(payload.get("network_hashrate_hps"))
    supply = decimal_or_none(payload.get("money_supply"))
    state = html.escape(str(payload.get("status") or "unknown"))

    lines = [
        "<b>PEPEPOW Network</b>",
        (
            f"Height: <code>{height:,}</code>"
            if height is not None
            else "Height: N/A"
        ),
        f"Hashrate: <code>{format_hashrate(hashrate)}</code>",
        f"Supply: <code>{format_supply(supply)}</code>",
        f"Data status: {state}",
    ]
    await update.message.reply_text(
        "\n".join(lines), parse_mode=ParseMode.HTML
    )


async def status_cmd(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    if update.message is None:
        return
    try:
        payload = await api.network()
        state = html.escape(str(payload.get("status") or "unknown"))
        await update.message.reply_text(
            f"PEPEW Light API: <b>{state}</b>",
            parse_mode=ParseMode.HTML,
        )
    except Exception:
        await update.message.reply_text("PEPEW Light API: unavailable")


def main() -> None:
    if not TOKEN:
        raise SystemExit("TELEGRAM_BOT4_TOKEN is not set")
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start_cmd))
    app.add_handler(CommandHandler("help", start_cmd))
    app.add_handler(CommandHandler("price", price_cmd))
    app.add_handler(CommandHandler("network", network_cmd))
    app.add_handler(CommandHandler("status", status_cmd))
    logger.info("Telegram PEPEPOW bot starting")
    app.run_polling(drop_pending_updates=False)


if __name__ == "__main__":
    main()
