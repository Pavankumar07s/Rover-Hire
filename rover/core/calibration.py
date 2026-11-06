import json
import re
from pathlib import Path

from .mcu import Calibration

CALIBRATION_FILE = Path(__file__).with_name("calibration.json")


def skill_value(name: str, path: Path = CALIBRATION_FILE):
    """Measured values used by rover/core/skills.py (not sent to the MCU)."""
    return json.loads(path.read_text())["skills"][name]


def load(path: Path = CALIBRATION_FILE, **overrides) -> Calibration:
    values = json.loads(path.read_text())["values"]
    values.update({k: v for k, v in overrides.items() if v is not None})
    return Calibration(**values)


def dumps(data: dict) -> str:
    """The file's own layout: two-space indent, ASCII escapes, short number lists on one line."""
    text = json.dumps(data, indent=2)
    return re.sub(r"\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]", lambda m: "[" + re.sub(r",\s+", ", ", m.group(1)) + "]", text) + "\n"


# calibration.py: load/save calibration.json; apply to MCU via set_cal / set_cal2 / set_cal3.
# Values are set from evidence files in prior-work/evidence/P1/ and P10A/.
# Each field carries a comment naming the evidence run that produced it.
def apply_to_mcu(bridge, cal: dict):
    bridge.call("set_cal",
        cal["cruise_pct"], cal["cruise_mm_s"], cal["batt_mv"],
        cal["kick_pct"], cal["kick_ms"], cal["floor_pct"],
        cal["turn_pct"], cal["kp_x10"], cal["brake_ms"],
        cal.get("mm_per_edge_x100", 0))
