#!/usr/bin/env python3
from pathlib import Path
import sys

KEEP = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_BOT_TOKEN2",
    "TELEGRAM_BOT4_TOKEN",
    "DISCORD_CHANNEL_ID",
    "DISCORD_CHANNEL_ID2",
    "DISCORD_CHANNEL_ID2_MC",
    "DISCORD_CHANNEL_NONKYC_PRICE",
    "DISCORD_CHANNEL_NESTEXPRICE",
    "DISCORD_CHANNEL_ID2_NESTEX",
    "DISCORD_CHANNEL_ID3",
    "DISCORD_CHANNEL_ID4",
    "DISCORD_CHANNEL_ID5",
]

if len(sys.argv) != 3:
    raise SystemExit("usage: migrate_env.py OLD_ENV NEW_ENV")

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
values = {}

for raw in src.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip()

lines = [
    "PEPEW_LIGHT_API_BASE_URL=https://light.pepepow.net",
    "BOT_UPDATE_SECONDS=600",
    "LOG_LEVEL=INFO",
    "",
]

for key in KEEP:
    if key in values:
        lines.append(f"{key}={values[key]}")

dst.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {dst}")
