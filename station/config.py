"""Station-A settings (plan Phase 12). Secrets live only in ~/0xbs-station/station.env (0600), never in git or logs."""
import os
from dataclasses import dataclass

STATION_ID = "station-a"
PORT = int(os.environ.get("STATION_PORT", "8710"))
POLL_S = 1.0          # read the MCU once a second
HISTORY_EVERY_S = 10  # keep one signed sample every 10 s
HISTORY_KEEP = 24 * 3600 // HISTORY_EVERY_S  # 24 h ring
FRESH_MS = 3000       # a reading older than this is refused (503)
TEMP_AGREE_CC = 150   # AHT20 and BMP280 within 1.5 °C
LIGHT_DARK = 758      # light_raw under a cup (the P12 watch test): 0 %
LIGHT_BRIGHT = 30     # light_raw with a torch against the LDR (the P12 watch test): 100 %


@dataclass(frozen=True)
class Secrets:
    private_key: str
    lan_token: str


def secrets() -> Secrets:
    key, token = os.environ.get("STATION_PRIVATE_KEY", ""), os.environ.get("STATION_LAN_TOKEN", "")
    if not key or len(token) < 24:
        raise SystemExit("STATION_PRIVATE_KEY and STATION_LAN_TOKEN (24+ chars) are needed: see station/tools/new_identity.py")
    return Secrets(key, token)
