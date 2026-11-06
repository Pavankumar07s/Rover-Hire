"""One straight leg toward (or away from) a flat wall, measured three ways: the sonar before and after (median of
1.5 s still), the encoder edges on each side, and the operator's scale. Prints the edges and the sonar distance;
mm per edge = real distance / edges. Stop rover.service first.
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.drive_cal --cm 50     (negative: drive back)
"""
import argparse
import statistics

from rover.tools.floor_test import LEASE_MS, Session, motion_summary, record

p = argparse.ArgumentParser()
p.add_argument("--cm", type=int, required=True)
p.add_argument("--brake", type=int, default=None)  # brake_ms for this leg only
a = p.parse_args()


def still(s, seconds=1.5):
    rows = s.pump(seconds)
    vals = [r["sonar_mm"] for r in rows if r["sonar_mm"] > 0]
    return (int(statistics.median(vals)) if vals else None), len(vals), rows[-1]


s = Session()
cal, _ = s.prepare(brake_ms=a.brake)
before, n0, st0 = still(s)
start = s.mcu.state()
s.next_hb = 0.0
s.beat()
s.mcu.drive_cm(a.cm, 0, LEASE_MS)
moving = s.pump(12, renew=True, until=lambda st: st["mode_name"] in ("brake", "idle"))
tail = s.pump(1.5)
res = motion_summary(moving, start, tail[-1])
after, n1, st1 = still(s)
enc = lambda st: (st["enc_l"] + st["enc_r"]) / 2
stop = moving[-1]
last200 = [x for x in moving if x["ms"] >= stop["ms"] - 200]
moved_after = [x for x in tail if enc(x) > enc(stop)]
stop_trace = {
    "edges_at_stop": enc(stop), "mm_at_stop": round(enc(stop) * cal.mm_per_edge_x100 / 100),
    "speed_before_stop_mm_s": round((enc(stop) - enc(last200[0])) * cal.mm_per_edge_x100 / 100 * 1000 / max(1, stop["ms"] - last200[0]["ms"])),
    "edges_after_stop": enc(tail[-1]) - enc(stop),
    "last_edge_ms_after_stop": (moved_after[-1]["ms"] - stop["ms"]) if moved_after else 0,
    "edges_after_stop_by_ms": {t: enc(next((x for x in reversed(tail) if x["ms"] - stop["ms"] <= t), stop)) - enc(stop) for t in (50, 100, 200, 400, 800)},
}
sonar_mm = before - after if before is not None and after is not None else None
edges = {"left": st1["enc_l"], "right": st1["enc_r"]}  # the firmware zeroes the counts when a motion starts
mean_edges = (edges["left"] + edges["right"]) / 2
out = {"cm": a.cm, "stop": res["stop_reason"], "firmware_dist_mm": res["dist_mm"], "yaw_drift_deg": res["yaw_change_deg"],
       "sonar_before_mm": before, "sonar_after_mm": after, "sonar_echoes": [n0, n1], "sonar_moved_mm": sonar_mm,
       "edges": edges, "mm_per_edge_by_sonar": round(abs(sonar_mm) / mean_edges, 2) if sonar_mm and mean_edges else None,
       "batt_min_mv": res["batt_min_mv"], "imu_resets": res["imu_resets"], "cruise_mm_s": cal.cruise_mm_s,
       "brake_ms": cal.brake_ms, "mm_per_edge_x100": cal.mm_per_edge_x100, "stop_trace": stop_trace}
record("drive_cal", {"cm": a.cm, "brake": a.brake}, out)


# drive_cal: one straight leg measured by sonar and encoder edges plus operator scale.
# --brake tries a brake time for one leg.
# Records encoder counts around the stop: speed at stop, edges after, last edge time.
# Used in P10A Stage S4 to fit cruise speed and roll_ms.
