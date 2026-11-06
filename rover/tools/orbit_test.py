"""Orbit legs around a box on the floor, to fit the pivot point the orbit circle assumes (pivot_behind_front_mm).
The rover starts facing a round target (a bucket: a square box echoes only when a face is square to the sonar: a test
saw it after 2 of 10 legs); before each series it is set to --start-mm from it. After each leg the sonar sweeps
+-10 deg and the nearest reading is the gap. A gap that shrinks leg after leg means the circle is too small.
Stop rover.service first. On the UNO Q:
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.orbit_test [--pivots 120,200] [--legs 5] [--orbit right]
Appends one JSON line to evidence/P2/orbit_test.jsonl.
"""
import argparse
import json
import signal
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

from rover.core import skills as skills_mod
from rover.core.bridge import McuWorker
from rover.core.calibration import skill_value
from rover.core.main import push_calibration
from rover.core.skills import LEASE_MS, Skills

EVIDENCE = Path.home() / "0xbs-rover" / "evidence" / "P2"
BOX_MM = (150, 900)  # a reading in this range is the box, not the room
MIN_GAP_MM = 250  # closer than this, stop: the next leg could touch the box


def sonar(worker, seconds=0.6):
    end, vals = time.monotonic() + seconds, []
    while time.monotonic() < end:
        v = worker.call("state")["sonar_mm"]
        if v >= 0:
            vals.append(v)
        time.sleep(0.06)
    return int(statistics.median(vals)) if vals else -1


def gap(sk, worker):
    """The nearest box reading straight ahead and 10 deg either side; the rover ends facing where it started."""
    reads = [sonar(worker)]
    for deg in (10, -20, 10):
        sk.turn(deg, correct=False)
        reads.append(sonar(worker))
    seen = [r for r in reads if BOX_MM[0] <= r <= BOX_MM[1]]
    return (min(seen) if seen else None), reads


def interrupt(signum, frame):
    raise KeyboardInterrupt


def main():
    signal.signal(signal.SIGTERM, interrupt)
    p = argparse.ArgumentParser()
    p.add_argument("--pivots", default="120,200")
    p.add_argument("--legs", type=int, default=5)
    p.add_argument("--orbit", choices=("left", "right"), default="right")
    p.add_argument("--start-mm", type=int, default=450)
    a = p.parse_args()

    worker = McuWorker(on_connect=push_calibration, require_kick=False).start()
    series = []
    try:
        while not worker.connected:
            time.sleep(0.2)
        worker.call("imu_cal", timeout=10)
        sk = Skills(worker, None, lambda: (True, None), 0)
        for pivot in [int(v) for v in a.pivots.split(",")]:
            skills_mod.skill_value = lambda name, pivot=pivot: pivot if name == "pivot_behind_front_mm" else skill_value(name)
            g, reads = gap(sk, worker)
            if g is None:
                print(f"pivot {pivot}: the sonar cannot see the box {reads}; stopping", flush=True)
                break
            if abs(g - a.start_mm) > 30:
                sk._run("drive_cm", round((g - a.start_mm) / 10), 0, LEASE_MS)
                g, reads = gap(sk, worker)
            legs = [{"leg": 0, "gap_mm": g, "reads": reads}]
            print(f"pivot {pivot}: start gap {g} mm", flush=True)
            for n in range(1, a.legs + 1):
                res = sk.orbit_leg(a.orbit, remembered_gap_mm=legs[-1]["gap_mm"] or a.start_mm)
                time.sleep(0.5)
                g, reads = gap(sk, worker)
                legs.append({"leg": n, "planned_mm": res["gap_mm"], "planned_from": res["gap_from"], "leg_cm": res["leg_cm"],
                             "blocked": res["blocked"], "net_deg": round(res["net_cdeg"] / 100, 1), "gap_mm": g, "reads": reads})
                print(legs[-1], flush=True)
                if res["blocked"] or (g is not None and g < MIN_GAP_MM):
                    print("stopping this series: blocked or too close", flush=True)
                    break
            seen = [(l["leg"], l["gap_mm"]) for l in legs if l["gap_mm"] is not None]
            per_leg = round((seen[-1][1] - seen[0][1]) / seen[-1][0]) if seen[-1][0] else None
            series.append({"pivot_mm": pivot, "legs": legs, "start_mm": seen[0][1], "end_mm": seen[-1][1], "seen": len(seen) - 1,
                           "per_leg_mm": per_leg})
            print(f"pivot {pivot}: {seen} -> {per_leg} mm per leg", flush=True)
    finally:
        try:
            worker.call("stop")
        except Exception:
            pass
        worker.stop()
    row = {"test": "orbit", "at": datetime.now(timezone.utc).isoformat(), "args": vars(a), "series": series}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    with open(EVIDENCE / "orbit_test.jsonl", "a") as f:
        f.write(json.dumps(row) + "\n")
    for s in series:
        print(json.dumps({k: s[k] for k in ("pivot_mm", "start_mm", "end_mm", "seen", "per_leg_mm")}), flush=True)


if __name__ == "__main__":
    main()


# orbit_test: drive real orbit legs at two pivot radii, fit the orbit pivot
# using sonar readings before and after each leg.
# Measures: actual leg length, actual heading change, sonar gap.
# Outputs: fitted pivot offset, recommended orbit default gap.
DEFAULT_ORBIT_GAP_MM = 450  # 45cm after P10 calibration
ORBIT_LEG_ANGLES_DEG = [72, -72]  # chord subtends 36deg each side of pivot
