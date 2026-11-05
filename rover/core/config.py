"""Runtime settings from the environment (systemd EnvironmentFile ~/0xbs-rover/rover.env)."""

import os
from dataclasses import dataclass
from pathlib import Path

ENV_FILE = Path.home() / "0xbs-rover" / "rover.env"


def load_env_file(path: Path = ENV_FILE) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


@dataclass(frozen=True)
class Settings:
    lan_token: str
    port: int
    camera_device: str
    test_mode: bool
    zg_api_key: str
    zg_log_url: str
    zg_log_token: str


def settings() -> Settings:
    load_env_file()
    token = os.environ.get("ROVER_LAN_TOKEN", "")
    if len(token) < 24:
        raise RuntimeError("ROVER_LAN_TOKEN must be set (24+ characters) in rover.env")
    return Settings(
        lan_token=token,
        port=int(os.environ.get("ROVER_PORT", "8700")),
        camera_device=os.environ.get("CAMERA_DEVICE", "/dev/v4l/by-id/usb-046d_081b_68564B60-video-index0"),
        test_mode=os.environ.get("ROVER_TEST_MODE") == "1",
        zg_api_key=os.environ.get("ZG_API_KEY", "").strip(),
        zg_log_url=os.environ.get("ZG_LOG_URL", "").strip(),
        zg_log_token=os.environ.get("ZG_LOG_TOKEN", "").strip(),
    )
# 2026-11-06T01:50:00
# 2026-11-06T22:10:00
