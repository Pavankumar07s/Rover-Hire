"""Wheels in the air: each side alone at each power, forward then backward; the battery dip shows how much current each
side draws (one motor of a pair disconnected or on a bad contact draws less). Stop rover.service first. On the UNO Q:
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.wheels_check [--duties 38,75,100] [--secs 2]
"""
import argparse
import statistics

from rover.tools.floor_test import LEASE_MS, Session, record

p = argparse.ArgumentParser()
p.add_argument("--duties", default="38,85")
p.add_argument("--secs", type=float, default=2.0)
a = p.parse_args()
duties = [int(d) for d in a.duties.split(",")]

s = Session()
s.prepare(imu=False)
rows = []
for duty in duties:
    for side in ("left", "right"):
        for sign in (1, -1):
            rest = [st["batt_now_mv"] for st in s.pump(1.0)]
            s.beat()
            s.mcu.set_duty(sign * duty if side == "left" else 0, sign * duty if side == "right" else 0, LEASE_MS)
            run = s.pump(a.secs, renew=True, until=lambda st: st["mode_name"] != "duty")
            s.mcu.stop()
            load = [st["batt_now_mv"] for st in run[len(run) // 3:]]  # skip the start-up surge
            rows.append({"step": len(rows) + 1, "side": side, "dir": "forward" if sign > 0 else "backward", "duty": duty,
                         "rest_mv": round(statistics.median(rest)), "load_mv": round(statistics.median(load)),
                         "dip_mv": round(statistics.median(rest) - statistics.median(load)), "stop": run[-1]["stop_name"]})
            print(rows[-1], flush=True)
            s.pump(2.0)
summary = []
for duty in duties:
    dip = {side: statistics.mean(r["dip_mv"] for r in rows if r["duty"] == duty and r["side"] == side) for side in ("left", "right")}
    summary.append({"duty": duty, "left_dip_mv": round(dip["left"]), "right_dip_mv": round(dip["right"]),
                    "left_over_right": round(dip["left"] / dip["right"], 2) if dip["right"] else None})
    print(summary[-1], flush=True)
record("wheels_up", {"secs": a.secs, "duties": duties}, {"rows": rows, "summary": summary})


# wheels_check: each side alone in the air at 38/75/100%, with battery dip.
# Identifies: dead motor, swapped encoder, reversed side, stiff gearbox.
# A side drawing 30% less current at the same power = bad contact (front-left, 6 Nov).
# A side slower than the other but drawing more current = stiff gearbox.
WHEEL_POWERS = [38, 75, 100]
WHEEL_RUN_MS = 2000
