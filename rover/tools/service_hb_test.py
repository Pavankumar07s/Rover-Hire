"""P2 service-level heartbeat test: kill -9 rover.service in the middle of a /test/duty pulse and
check that the MCU stops on its own heartbeat watchdog. Needs the service running with ROVER_TEST_MODE=1.
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.service_hb_test [--duty 40]
This process only reads state over its own Bridge connection; it never sends heartbeats.
"""

import argparse
import json
import os
import signal
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from rover.core.config import settings
from rover.core.mcu import connect

EVIDENCE = Path.home() / "0xbs-rover" / "evidence" / "P2"
LIMIT_MS = 310  # HEARTBEAT_TIMEOUT_MS 300 plus one 10 ms control tick


def service_pid():
    out = subprocess.run(["pgrep", "-f", "^/home/arduino/0xbs-rover/venv/bin/python -m rover.core.main|^venv/bin/python -m rover.core.main"],
                         capture_output=True, text=True).stdout.split()
    if len(out) != 1:
        raise SystemExit(f"expected one rover service process, found {out}")
    return int(out[0])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--duty", type=int, default=40)
    p.add_argument("--after", type=float, default=0.5, help="seconds of motion before the kill")
    a = p.parse_args()
    s = settings()
    mcu = connect()
    pid = service_pid()
    req = urllib.request.Request(f"http://127.0.0.1:{s.port}/test/duty", method="POST",
                                 data=json.dumps({"l": a.duty, "r": a.duty, "lease_ms": 1500}).encode(),
                                 headers={"X-Rover-Token": s.lan_token, "Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=3).read()
    time.sleep(a.after)
    moving = mcu.state()
    os.kill(pid, signal.SIGKILL)
    killed_at = time.monotonic()
    samples = []
    while time.monotonic() - killed_at < 1.5:
        st = mcu.state()
        samples.append(st)
        if st["mode_name"] in ("brake", "idle") and st["halt_ms"] >= moving["start_ms"]:
            break
        time.sleep(0.01)
    last = samples[-1]
    stopped_after_hb = last["halt_ms"] - last["hb_ms"]
    row = {
        "test": "service_heartbeat", "at": datetime.now(timezone.utc).isoformat(), "args": vars(a),
        "mode_before_kill": moving["mode_name"], "batt_mv": moving["batt_mv"],
        "stop_reason": last["stop_name"], "halt_minus_last_hb_ms": stopped_after_hb,
        "halt_minus_start_ms": last["halt_ms"] - moving["start_ms"],
        "pass": moving["mode_name"] == "duty" and last["stop_name"] == "heartbeat" and stopped_after_hb <= LIMIT_MS,
    }
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    with open(EVIDENCE / "service_heartbeat.jsonl", "a") as f:
        f.write(json.dumps(row) + "\n")
    print(json.dumps(row, indent=1))


if __name__ == "__main__":
    main()
