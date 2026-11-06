"""Wheels in the air, with the encoders: gyro calibration and encoder noise at rest, then each side alone at each power,
forward then backward. Battery dip per side (as wheels_check) plus encoder edges per side; the side that is not driven
must count 0. Stop rover.service first. On the UNO Q:
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.wheels_enc_check [--duties 38,75,100] [--secs 2]
"""
import argparse
import json
import statistics
import time

from rover.tools.floor_test import LEASE_MS, Session, record

p = argparse.ArgumentParser()
p.add_argument("--duties", default="38,75,100")
p.add_argument("--secs", type=float, default=2.0)
a = p.parse_args()
duties = [int(d) for d in a.duties.split(",")]

s = Session()
cal, bias = s.prepare(imu=True)
still = s.pump(3.0)
pre = {
    "gyro_bias": bias,
    "imu_ok": bool(still[-1]["flags"] & 2),
    "rate_dps_at_rest_median": round(statistics.median(abs(x["rate_cdps"]) for x in still) / 100, 2),
    "imu_resets": still[-1]["imu_resets"],
    "encoder_edges_at_rest_3s": {"left": still[-1]["enc_l"] - still[0]["enc_l"], "right": still[-1]["enc_r"] - still[0]["enc_r"]},
    "sonar_mm_median": statistics.median(x["sonar_mm"] for x in still),
    "batt_mv": still[-1]["batt_mv"],
}
print(json.dumps(pre), flush=True)

rows = []
for duty in duties:
    for side in ("left", "right"):
        for sign in (1, -1):
            rest = s.pump(1.0)
            r0 = rest[-1]
            s.beat()
            s.mcu.set_duty(sign * duty if side == "left" else 0, sign * duty if side == "right" else 0, LEASE_MS)
            t0 = time.monotonic()
            run = s.pump(a.secs, renew=True, until=lambda st: st["mode_name"] != "duty")
            secs = time.monotonic() - t0
            s.mcu.stop()
            r1 = run[-1]
            coast = s.pump(1.0)
            load = [x["batt_now_mv"] for x in run[len(run) // 3:]]
            other = "right" if side == "left" else "left"
            k, ko = ("enc_l", "enc_r") if side == "left" else ("enc_r", "enc_l")
            rows.append({"duty": duty, "side": side, "dir": "forward" if sign > 0 else "backward",
                         "dip_mv": round(statistics.median(x["batt_now_mv"] for x in rest) - statistics.median(load)),
                         "edges": r1[k] - r0[k], "edges_per_s": round((r1[k] - r0[k]) / secs, 1),
                         "coast_edges": coast[-1][k] - r1[k], f"{other}_edges": coast[-1][ko] - r0[ko],
                         "stop": r1["stop_name"], "imu_resets": coast[-1]["imu_resets"]})
            print(json.dumps(rows[-1]), flush=True)
            s.pump(1.5)

summary = []
for duty in duties:
    side = {sd: [r for r in rows if r["duty"] == duty and r["side"] == sd] for sd in ("left", "right")}
    eps = {sd: statistics.mean(r["edges_per_s"] for r in side[sd]) for sd in side}
    dip = {sd: statistics.mean(r["dip_mv"] for r in side[sd]) for sd in side}
    summary.append({"duty": duty, "left_edges_per_s": round(eps["left"], 1), "right_edges_per_s": round(eps["right"], 1),
                    "left_over_right_speed": round(eps["left"] / eps["right"], 2) if eps["right"] else None,
                    "left_dip_mv": round(dip["left"]), "right_dip_mv": round(dip["right"]),
                    "left_over_right_dip": round(dip["left"] / dip["right"], 2) if dip["right"] else None})
    print(json.dumps(summary[-1]), flush=True)
record("wheels_enc_up", {"secs": a.secs, "duties": duties}, {"pre": pre, "rows": rows, "summary": summary})
