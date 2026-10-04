from __future__ import annotations

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
    source_decimal,
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
        "/price — PEPEW multi-source market summary\n"
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

    try:
        payload = await api.market()
    except Exception as exc:
        logger.warning("Telegram market request failed: %s", exc)
        await update.message.reply_text(
            "PEPEW market data is temporarily unavailable."
        )
        return

    cmc_price = source_decimal(payload, "cmc", "price_usd")
    nonkyc_price = source_decimal(payload, "nonkyc", "price_usd")
    nonkyc_volume = source_decimal(payload, "nonkyc", "volume_24h_usd")
    nestex_price = source_decimal(payload, "nestex", "price_usd")
    nestex_volume = source_decimal(payload, "nestex", "volume_24h_usd")
    total_volume = decimal_or_none(payload.get("total_volume_24h_usd"))
    market_cap = decimal_or_none(payload.get("market_cap_onchain_usd"))
    state = html.escape(str(payload.get("status") or "unknown"))

    lines = ["<b>PEPEPOW Price Overview</b>"]

    if cmc_price is not None:
        lines.append(
            f"• CMC price: <code>{format_price(cmc_price)}</code> USD"
        )
    else:
        lines.append("• CMC price: unavailable")

    if nonkyc_price is not None:
        lines.append(
            f"• NonKYC price: <code>{format_price(nonkyc_price)}</code> USD\n"
            f"  NonKYC 24h Vol (USDT+BNB): "
            f"<code>{format_usd(nonkyc_volume)}</code> USD"
        )
    else:
        lines.append("• NonKYC: unavailable")

    if nestex_price is not None:
        lines.append(
            f"• NestEx price: <code>{format_price(nestex_price)}</code> USD\n"
            f"  NestEx 24h Vol (USDT): "
            f"<code>{format_usd(nestex_volume)}</code> USD"
        )
    else:
        lines.append("• NestEx: unavailable")

    if total_volume is not None:
        lines.append(
            f"• Total 24h Vol: <code>{format_usd(total_volume)}</code> USD"
        )

    if market_cap is not None:
        lines.append(
            "• MarketCap (on-chain supply × CMC price): "
            f"<code>{format_usd(market_cap)}</code> USD"
        )

    if state != "ok":
        lines.append(f"• Data status: {state}")

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
        network = await api.network()
        market = await api.market()
        network_state = html.escape(str(network.get("status") or "unknown"))
        market_state = html.escape(str(market.get("status") or "unknown"))
        await update.message.reply_text(
            "PEPEW Light API\n"
            f"Network: <b>{network_state}</b>\n"
            f"Market: <b>{market_state}</b>",
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
