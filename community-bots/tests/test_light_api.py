from decimal import Decimal

from pepepow_bots.light_api import (
    decimal_or_none,
    format_hashrate,
    format_price,
    format_supply,
    format_usd,
    int_or_none,
    price_usdt,
    source_decimal,
    volume_24h_usd,
)


def test_price_payload_helpers():
    payload = {
        "status": "ok",
        "price_usdt": "0.00001230",
        "volume_24h_usd": "1234.5",
    }
    assert price_usdt(payload) == Decimal("0.00001230")
    assert volume_24h_usd(payload) == Decimal("1234.5")
    assert format_price(price_usdt(payload)) == "0.0000123"
    assert format_usd(volume_24h_usd(payload)) == "1,234"


def test_format_network_values():
    assert int_or_none("4980000") == 4980000
    assert format_hashrate(decimal_or_none("2500000000")) == "2.5 GH/s"
    assert format_supply(decimal_or_none("81234567890")) == "81.2B"


def test_market_source_helper():
    payload = {"sources": {"cmc": {"price_usd": "0.00000077"}}}
    assert source_decimal(payload, "cmc", "price_usd") == Decimal("0.00000077")
    assert source_decimal(payload, "nestex", "price_usd") is None
