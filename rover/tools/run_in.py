"""Wheels in the air: run one side (or both) through a cycle of powers, forward and backward, to work fresh oil into the
gearboxes. Prints the battery dip of each stretch (less dip at the same power = less drag). Stop rover.service first:
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.run_in --side left [--secs 120] [--duties 38,60,75,100] [--chunk 10]
"""
import argparse
import statistics

from rover.tools.floor_test import LEASE_MS, Session, record

p = argparse.ArgumentParser()
p.add_argument("--side", choices=("left", "right", "both"), default="left")
p.add_argument("--secs", type=float, default=120.0)
p.add_argument("--duties", default="38,60,75,100")
p.add_argument("--chunk", type=float, default=10.0)
a = p.parse_args()
duties = [int(d) for d in a.duties.split(",")]

s = Session()
s.prepare(imu=False)
rows, ran, k = [], 0.0, 0
while ran < a.secs:
    duty = duties[k % len(duties)]
    sign = 1 if (k // len(duties)) % 2 == 0 else -1
    secs = min(a.chunk, a.secs - ran)
    rest = [st["batt_now_mv"] for st in s.pump(1.0)]
    s.beat()
    s.mcu.set_duty(sign * duty if a.side != "right" else 0, sign * duty if a.side != "left" else 0, LEASE_MS)
    run = s.pump(secs, renew=True, until=lambda st: st["mode_name"] != "duty")
    s.mcu.stop()
    load = [st["batt_now_mv"] for st in run[len(run) // 3:]]
    rows.append({"n": k + 1, "duty": duty, "dir": "forward" if sign > 0 else "backward", "secs": round(secs, 1),
                 "dip_mv": round(statistics.median(rest) - statistics.median(load)), "batt_mv": round(statistics.median(rest)),
                 "stop": run[-1]["stop_name"]})
    print(rows[-1], flush=True)
    if run[-1]["mode_name"] != "duty":  # the rover stopped by itself (battery, lease, ...)
        print("stopped by the rover:", run[-1]["stop_name"], flush=True)
        break
    ran += secs
    k += 1
s.pump(1.0)
by_duty = {d: [r["dip_mv"] for r in rows if r["duty"] == d] for d in duties}
summary = {d: {"first_mv": v[0], "last_mv": v[-1]} for d, v in by_duty.items() if v}
print(summary, flush=True)
record("run_in", {"side": a.side, "secs": a.secs, "duties": duties, "chunk": a.chunk}, {"rows": rows, "summary": summary})
