from __future__ import annotations

import os
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://light.pepepow.net"


class LightAPIError(RuntimeError):
    pass


class LightAPI:
    def __init__(self, base_url: str | None = None, timeout: float = 8.0) -> None:
        self.base_url = (
            base_url or os.getenv("PEPEW_LIGHT_API_BASE_URL") or DEFAULT_BASE_URL
        ).rstrip("/")
        self.timeout = timeout

    async def _get_json(self, path: str) -> dict[str, Any]:
        headers = {"User-Agent": "pepepow-community-bots/2"}
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout, headers=headers
            ) as client:
                response = await client.get(f"{self.base_url}{path}")
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise LightAPIError(
                f"Light API request failed for {path}: {exc}"
            ) from exc
        if not isinstance(payload, dict):
            raise LightAPIError(f"Light API returned non-object JSON for {path}")
        return payload

    async def price(self) -> dict[str, Any]:
        return await self._get_json("/api/price")

    async def network(self) -> dict[str, Any]:
        return await self._get_json("/api/network")


def decimal_or_none(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def price_usdt(payload: dict[str, Any]) -> Decimal | None:
    if payload.get("status") not in {"ok", "stale"}:
        return None
    return decimal_or_none(payload.get("price_usdt") or payload.get("price"))


def volume_24h_usd(payload: dict[str, Any]) -> Decimal | None:
    return decimal_or_none(payload.get("volume_24h_usd"))


def format_price(value: Decimal | None) -> str:
    if value is None:
        return "N/A"
    text = f"{value:.8f}".rstrip("0").rstrip(".")
    return text or "0"


def format_usd(value: Decimal | None) -> str:
    if value is None:
        return "N/A"
    return f"{value.quantize(Decimal('1')):,.0f}"


def format_supply(value: Decimal | None) -> str:
    if value is None:
        return "N/A"
    billion = value / Decimal("1000000000")
    return f"{billion:.1f}B"


def format_hashrate(hps: Decimal | None) -> str:
    if hps is None:
        return "N/A"
    scales = (
        (Decimal("1000000000000"), "TH/s"),
        (Decimal("1000000000"), "GH/s"),
        (Decimal("1000000"), "MH/s"),
        (Decimal("1000"), "kH/s"),
    )
    magnitude = abs(hps)
    for divisor, suffix in scales:
        if magnitude >= divisor:
            return f"{hps / divisor:.1f} {suffix}"
    return f"{hps:.0f} H/s"
