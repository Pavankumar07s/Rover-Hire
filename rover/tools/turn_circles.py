"""Full circles in place: for each angle, 360/angle turns one way, then the same back the other way. Per turn: the angle
reached, stop reason, peak rate, lowest battery reading, gyro resets. Per circle: the gyro's total and the sonar before
and after (the same reading means it faces where it started). Stops at a battery or gyro stop. Stop rover.service first.
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.turn_circles [--angles 30,45,90] [--count N] [--duty 85] [--kick 100]
--count N turns N times each way instead of one full circle (the sonar check then only means something if N x angle is 360).
"""
import argparse
import json
import signal
import sys

from rover.tools.floor_test import LEASE_MS, Session, record, run_motion, sonar_still

p = argparse.ArgumentParser()
p.add_argument("--angles", default="30,45,90")
p.add_argument("--duty", type=int, default=None)
p.add_argument("--kick", type=int, default=None)
p.add_argument("--count", type=int, default=0)
a = p.parse_args()

s = Session()
cal, bias = s.prepare(turn_pct=a.duty, turn_kick_pct=a.kick)
circles, aborted = [], None
signal.signal(signal.SIGTERM, lambda *_: sys.exit(1))
try:
    for angle in [int(x) for x in a.angles.split(",")]:
        for sign, way in ((1, "left"), (-1, "right")):
            before = sonar_still(s)
            yaw0 = s.mcu.state()["yaw_cdeg"]
            turns = []
            for i in range(a.count or 360 // angle):
                res = run_motion(s, lambda: s.mcu.turn_deg(sign * angle, LEASE_MS), max_s=6)
                s.pump(0.4)
                turns.append({"achieved_deg": res["yaw_change_deg"], "stop": res["stop_reason"], "peak_dps": res["peak_rate_dps"],
                              "batt_min_mv": res["batt_min_mv"], "imu_resets": res["imu_resets"]})
                if res["stop_reason"] in ("battery", "imu"):
                    aborted = f"{angle} {way} turn {i + 1}: {res['stop_reason']} stop"
                    break
            total = round((s.mcu.state()["yaw_cdeg"] - yaw0) / 100, 1)
            after = sonar_still(s)
            done = [t for t in turns if t["stop"] == "done"]
            row = {"angle": angle, "way": way, "turns": len(turns), "done": len(done),
                   "stalled": sum(t["stop"] == "stall" for t in turns), "target_deg": sign * angle * len(turns), "gyro_total_deg": total,
                   "worst_turn_error_deg": round(max(abs(abs(t["achieved_deg"]) - angle) for t in turns), 1),
                   "lowest_batt_mv": min(t["batt_min_mv"] for t in turns), "imu_resets": turns[-1]["imu_resets"],
                   "sonar_before_mm": before, "sonar_after_mm": after, "each": [t["achieved_deg"] for t in turns],
                   "peak_dps": [t["peak_dps"] for t in turns], "stops": [t["stop"] for t in turns]}
            circles.append(row)
            print(json.dumps({k: v for k, v in row.items() if k != "each"}), flush=True)
            print("   each:", row["each"], flush=True)
            if aborted:
                break
        if aborted:
            break
except (KeyboardInterrupt, SystemExit):
    aborted = f"stopped by hand during the {len(circles) + 1}. circle"
    s.mcu.stop()
finally:
    record("turn_circles", {"angles": a.angles, "count": a.count, "turn_pct": cal.turn_pct, "turn_kick_pct": cal.turn_kick_pct},
           {"circles": circles, "aborted": aborted, "pass": not aborted and all(c["done"] == c["turns"] for c in circles)})


# turn_circles: N full-circle turns in place at the current calibration.
# Saves results when stopped (Ctrl-C), keeping each turn's peak rate and stop reason.
# Used in P10A Stage S6 and for the stall-guard verification (150de62).
# --count N defaults to 48 turns (enough to detect a rare stall pattern).
DEFAULT_N = 48
