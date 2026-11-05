"""P1 floor tests for firmware/rover_mcu. Run on the UNO Q:
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.floor_test <test> [options]
Every test appends one JSON line to evidence/P1/<test>.jsonl.
"""

import argparse
import json
import signal
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

from rover.core import calibration
from rover.core.mcu import FACES, McuError, connect

EVIDENCE = Path.home() / "0xbs-rover" / "evidence" / "P1"
LEASE_MS = 1500
REQUIRED = object()


class Session:
    def __init__(self):
        self.mcu = connect()
        self.seq = 0
        self.next_hb = 0.0

    def beat(self):
        now = time.monotonic()
        if now >= self.next_hb:
            self.mcu.heartbeat(self.seq)
            self.seq += 1
            self.next_hb = now + 0.1

    def pump(self, seconds, renew=False, beat=True, until=None):
        samples, next_lease, end = [], 0.0, time.monotonic() + seconds
        while time.monotonic() < end:
            if beat:
                self.beat()
            if renew and time.monotonic() >= next_lease:
                self.mcu.lease(LEASE_MS)
                next_lease = time.monotonic() + 0.5
            s = self.mcu.state()
            samples.append(s)
            if until and until(s):
                break
            time.sleep(0.02)
        return samples

    def settle(self, seconds=5.0):
        """Until the rover has really stopped: idle (brake over) and yaw rate < 2 deg/s for 5 samples.
        It keeps coasting after the brake, so the brake moment is not the final heading."""
        calm = []

        def still(st):
            calm.append(st["mode_name"] == "idle" and abs(st["rate_cdps"]) < 200)
            return len(calm) >= 5 and all(calm[-5:])

        return self.pump(seconds, until=still)[-1]

    def prepare(self, imu=True, **overrides):
        self.next_hb = 0.0
        self.beat()
        cal = calibration.load(**overrides)
        self.mcu.set_cal(cal)
        bias = self.mcu.imu_cal() if imu else None
        self.next_hb = 0.0
        self.beat()
        return cal, bias


def record(test, args, result):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    row = {"test": test, "at": datetime.now(timezone.utc).isoformat(), "args": args, **result}
    with open(EVIDENCE / f"{test}.jsonl", "a") as f:
        f.write(json.dumps(row) + "\n")
    print(json.dumps(row, indent=1))
    return row


def motion_summary(samples, start_state, still):
    last = samples[-1]
    return {
        "stop_reason": last["stop_name"],
        "elapsed_ms": last["halt_ms"] - last["start_ms"],
        "yaw_change_deg": round((still["yaw_cdeg"] - start_state["yaw_cdeg"]) / 100, 2),
        "yaw_at_brake_deg": round((last["yaw_cdeg"] - start_state["yaw_cdeg"]) / 100, 2),
        "peak_rate_dps": round(max(abs(s["rate_cdps"]) for s in samples) / 100, 1),
        "dist_mm": last["dist_mm"],
        "sonar_at_halt_mm": last["sonar_mm"],
        "batt_mv": start_state["batt_mv"],
        "batt_min_mv": last["batt_min_mv"],
        "imu_resets": last["imu_resets"],
    }


def t_info(s, a):
    st = s.mcu.state()
    return {"info": s.mcu.info(), "state": st}


def t_faces(s, a):
    shown = []
    for name in ("idle", "ready", "thinking", "moving", "0G?", "!TEE", "402", "STOP", "DONE", "BAT"):
        s.mcu.face(name)
        shown.append(name)
        time.sleep(a.hold)
    s.mcu.face("ready")
    return {"shown": shown, "pass": s.mcu.state()["face"] == FACES["ready"]}


def t_wiring(s, a):
    s.prepare(imu=False)
    steps = []
    for label, l, r in (("forward", a.duty, a.duty), ("spin_left", -a.duty, a.duty), ("spin_right", a.duty, -a.duty)):
        s.beat()
        try:
            s.mcu.set_duty(l, r, LEASE_MS)
        except McuError as e:
            steps.append({"step": label, "refused": str(e), "batt_mv": s.mcu.state()["batt_mv"]})
            break
        samples = s.pump(a.secs, renew=True, until=lambda st: st["mode_name"] != "duty")
        s.mcu.stop()
        end = s.settle()
        steps.append({"step": label, "left": l, "right": r, "ran_ms": samples[-1]["ms"] - samples[0]["ms"],
                      "stop_reason": samples[-1]["stop_name"], "batt_min_mv": end["batt_min_mv"]})
        s.pump(1.5)
    return {"steps": steps, "pass": None, "observe": "all four forward; spins turn the sides opposite ways"}


def t_heartbeat(s, a):
    s.prepare(imu=False)
    s.beat()
    s.mcu.set_duty(a.duty, a.duty, LEASE_MS)
    s.pump(0.5)
    samples = s.pump(2.0, beat=False, until=lambda st: st["mode_name"] in ("brake", "idle"))
    last = samples[-1]
    latency = last["halt_ms"] - last["hb_ms"]
    s.settle()
    return {"stop_reason": last["stop_name"], "halt_after_last_heartbeat_ms": latency,
            "pass": last["stop_name"] == "heartbeat" and latency <= 310}


def t_lease(s, a):
    s.prepare(imu=False)
    s.beat()
    s.mcu.set_duty(a.duty, a.duty, a.ms)
    samples = s.pump(a.ms / 1000 + 1.0, until=lambda st: st["mode_name"] in ("brake", "idle"))
    last = samples[-1]
    ran = last["halt_ms"] - last["start_ms"]
    s.settle()
    return {"stop_reason": last["stop_name"], "ran_ms": ran, "lease_ms": a.ms,
            "pass": last["stop_name"] == "lease" and abs(ran - a.ms) <= 30}


def t_sonar(s, a):
    s.beat()
    readings, medians, lost = [], [], 0
    last_ping = s.mcu.state()["pings"]
    end = time.monotonic() + 30
    while len(readings) + lost < a.pings and time.monotonic() < end:
        st = s.mcu.state()
        if st["pings"] != last_ping:
            last_ping = st["pings"]
            if st["sonar_raw_mm"] < 0:
                lost += 1
            else:
                readings.append(st["sonar_raw_mm"])
                if st["sonar_mm"] >= 0:
                    medians.append(st["sonar_mm"])
        time.sleep(0.02)
    target = a.cm * 10
    med = statistics.median(medians) if medians else None
    spread = (max(readings) - min(readings)) if readings else None
    return {"target_mm": target, "pings": len(readings) + lost, "lost": lost, "median3_median_mm": med,
            "raw_min_mm": min(readings) if readings else None, "raw_max_mm": max(readings) if readings else None,
            "raw_spread_mm": spread, "error_mm": None if med is None else med - target,
            "pass": lost == 0 and med is not None and abs(med - target) <= 20}


def run_motion(s, start, renew=True, max_s=6.0):
    before = s.mcu.state()
    s.next_hb = 0.0
    s.beat()
    start()
    samples = s.pump(max_s, renew=renew, until=lambda st: st["mode_name"] in ("brake", "idle"))
    return motion_summary(samples, before, s.settle())


def t_startduty(s, a):
    s.prepare(imu=False)
    s.beat()
    s.mcu.set_duty(a.duty, a.duty, 1000)
    samples = s.pump(1.3, until=lambda st: st["mode_name"] in ("brake", "idle"))
    s.settle()
    return {"duty": a.duty, "stop_reason": samples[-1]["stop_name"], "batt_mv": samples[0]["batt_mv"],
            "batt_min_mv": samples[-1]["batt_min_mv"], "pass": None,
            "observe": "did all four wheels start turning from standstill?"}


def t_cruise(s, a):
    cal, bias = s.prepare(cruise_pct=a.duty, floor_pct=a.floor)
    res = run_motion(s, lambda: s.mcu.drive_ms(a.ms, a.duty, LEASE_MS), max_s=a.ms / 1000 + 2)
    return {**res, "duty": a.duty, "floor_pct": cal.floor_pct, "ms": a.ms, "gyro_bias_x100": bias, "pass": None,
            "measure": "tape-measure the straight-line distance and record it with: note cruise --mm <mm>"}


def t_kick(s, a):
    s.prepare()
    runs = []
    for _ in range(a.runs):
        runs.append(run_motion(s, lambda: s.mcu.drive_ms(a.ms, 0, LEASE_MS), max_s=a.ms / 1000 + 2))
        s.pump(0.8)
    return {"runs": runs, "pass": None, "observe": "did all four wheels start every time?"}


def t_drive(s, a):
    cal, _ = s.prepare(kp_x10=a.kp)
    res = run_motion(s, lambda: s.mcu.drive_cm(a.cm, 0, LEASE_MS), max_s=10)
    return {**res, "cm": a.cm, "kp_x10": cal.kp_x10, "cruise_mm_s": cal.cruise_mm_s,
            "pass": None if res["stop_reason"] == "done" else False,
            "measure": "tape-measure the distance and record it with: note drive --mm <mm>"}


def t_turn(s, a):
    cal, _ = s.prepare(turn_pct=a.duty, turn_kick_pct=a.kick)
    res = run_motion(s, lambda: s.mcu.turn_deg(a.deg, LEASE_MS), max_s=6)
    achieved = abs(res["yaw_change_deg"])
    return {**res, "deg": a.deg, "turn_pct": cal.turn_pct, "turn_kick_pct": cal.turn_kick_pct,
            "pass": res["stop_reason"] == "done" and abs(achieved - abs(a.deg)) <= 5}


def t_reflex(s, a):
    s.prepare()
    res = run_motion(s, lambda: s.mcu.drive_cm(a.cm, 0, LEASE_MS), max_s=12)
    return {**res, "pass": res["stop_reason"] == "reflex",
            "measure": "tape-measure the final gap to the wall and record it with: note reflex --mm <mm>"}


def t_cutoff(s, a):
    s.prepare(imu=False)
    batt = s.mcu.state()["batt_mv"]
    raised = min(9000, batt + 500)
    s.mcu.set_cutoff(raised)
    s.beat()
    try:
        s.mcu.set_duty(30, 30, 300)
        refused = False
    except McuError as e:
        refused = "low_battery" in str(e)
    face = s.mcu.state()["face"]
    s.mcu.set_cutoff(7000)
    s.beat()
    s.mcu.set_duty(30, 30, 300)
    after = s.settle()
    return {"batt_mv": batt, "raised_cutoff_mv": raised, "refused_when_raised": refused,
            "face_when_raised": face, "after_restore_stop": after["stop_name"], "after_restore_min_mv": after["batt_min_mv"],
            "pass": refused and face == FACES["BAT"] and after["stop_name"] == "lease"}


def t_battery(s, a):
    """Voltage trace through a spin with the cutoff lowered to 5.0 V for the run (wheels in the air)."""
    s.prepare(imu=False)
    s.mcu.set_cutoff(5000)
    trace = []
    try:
        rest = [s.mcu.state() for _ in range(10)]
        s.beat()
        s.mcu.set_duty(a.duty, a.duty, a.ms)
        end = time.monotonic() + a.ms / 1000 + a.after
        while time.monotonic() < end:
            s.beat()
            st = s.mcu.state()
            trace.append({"ms": st["ms"], "mode": st["mode_name"], "now_mv": st["batt_now_mv"], "avg_mv": st["batt_mv"]})
            time.sleep(0.01)
    finally:
        s.mcu.set_cutoff(7000)
    during = [t["now_mv"] for t in trace if t["mode"] == "duty"]
    after = [t["now_mv"] for t in trace if t["mode"] != "duty"]
    return {"duty": a.duty, "ms": a.ms, "cutoff_during_test_mv": 5000, "rest_mv": rest[-1]["batt_now_mv"],
            "during_min_mv": min(during) if during else None, "during_median_mv": statistics.median(during) if during else None,
            "after_min_mv": min(after) if after else None, "after_last_mv": after[-1] if after else None,
            "trace": trace, "pass": None}


def sonar_still(s, seconds=0.8):
    vals = [st["sonar_mm"] for st in s.pump(seconds) if st["sonar_mm"] >= 0]
    return int(statistics.median(vals)) if vals else None


def t_drives(s, a):
    """Forward then back toward a wall; the sonar measures each leg."""
    rows = []
    for kp in [int(k) for k in a.kps.split(",")]:
        cal, _ = s.prepare(kp_x10=kp, cruise_mm_s=a.cruise, drive_lag_ms=a.lag)
        for sign in (1, -1):
            before = sonar_still(s)
            res = run_motion(s, lambda: s.mcu.drive_cm(sign * a.cm, 0, LEASE_MS), max_s=10)
            after = sonar_still(s)
            moved = None if before is None or after is None else (before - after) * sign
            rows.append({"kp_x10": kp, "cm": sign * a.cm, "sonar_before_mm": before, "sonar_after_mm": after,
                         "moved_mm": moved, **res})
    fwd = [r for r in rows if r["cm"] > 0 and r["moved_mm"] is not None]
    return {"runs": rows, "cruise_mm_s_used": cal.cruise_mm_s, "drive_lag_ms_used": cal.drive_lag_ms,
            "forward_mean_mm": round(statistics.mean(r["moved_mm"] for r in fwd)) if fwd else None,
            "pass": all(abs(r["moved_mm"] - a.cm * 10) <= 80 and abs(r["yaw_change_deg"]) < 5 for r in rows if r["moved_mm"] is not None)}


def t_turns(s, a):
    cal, _ = s.prepare(turn_pct=a.duty, turn_kick_pct=a.kick)
    before = sonar_still(s)
    rows = []
    for i in range(a.reps):
        for sign in (1, -1):
            res = run_motion(s, lambda: s.mcu.turn_deg(sign * a.deg, LEASE_MS), max_s=6)
            s.pump(0.4)
            rows.append({"deg": sign * a.deg, "achieved_deg": res["yaw_change_deg"], **res})
    after = sonar_still(s)
    ok = [r for r in rows if r["stop_reason"] == "done" and abs(abs(r["achieved_deg"]) - a.deg) <= 5]
    return {"turn_pct": cal.turn_pct, "turn_kick_pct": cal.turn_kick_pct, "turns": rows, "sonar_before_mm": before, "sonar_after_mm": after,
            "within_5_deg": len(ok), "of": len(rows), "pass": len(ok) == len(rows)}


def board_temp_c():
    temps = []
    for z in Path("/sys/class/thermal").glob("thermal_zone*"):
        try:
            temps.append(int((z / "temp").read_text()) / 1000)
        except (OSError, ValueError):
            pass
    return max(temps) if temps else None


def t_soak(s, a):
    """Back-to-back +-90 turns in place for a.minutes: board heat, tape wear, turn drift, IMU resets."""
    cal, _ = s.prepare()
    end, rows, sign, stopped_early = time.monotonic() + a.minutes * 60, [], 1, False
    try:
        while time.monotonic() < end:
            res = run_motion(s, lambda: s.mcu.turn_deg(sign * 90, LEASE_MS), max_s=6)
            rows.append({"t_s": round(a.minutes * 60 - (end - time.monotonic())), "achieved_deg": res["yaw_change_deg"],
                         "stop": res["stop_reason"], "batt_min_mv": res["batt_min_mv"], "imu_resets": res["imu_resets"],
                         "board_c": board_temp_c()})
            sign = -sign
            if res["stop_reason"] in ("imu", "battery"):
                break
            s.pump(1.0)
    except KeyboardInterrupt:
        stopped_early = True
    if not rows:
        return {"minutes": a.minutes, "turns": 0, "stopped_early": stopped_early, "pass": False}
    good = [r for r in rows if r["stop"] == "done" and 85 <= abs(r["achieved_deg"]) <= 95]
    return {"minutes": a.minutes, "stopped_early": stopped_early, "turns": len(rows), "within_85_95": len(good), "rows": rows,
            "board_max_c": max((r["board_c"] for r in rows if r["board_c"] is not None), default=None),
            "pass": len(good) == len(rows) and all((r["board_c"] or 0) < 80 for r in rows)}


def t_note(s, a):
    return {"for_test": a.for_test, "measured_mm": a.mm, "remark": a.remark}


TESTS = {
    "info": (t_info, []),
    "faces": (t_faces, [("--hold", float, 1.5)]),
    "wiring": (t_wiring, [("--duty", int, 45), ("--secs", float, 1.2)]),
    "heartbeat": (t_heartbeat, [("--duty", int, 45)]),
    "lease": (t_lease, [("--duty", int, 45), ("--ms", int, 500)]),
    "sonar": (t_sonar, [("--cm", int, REQUIRED), ("--pings", int, 60)]),
    "startduty": (t_startduty, [("--duty", int, REQUIRED)]),
    "cruise": (t_cruise, [("--duty", int, 40), ("--ms", int, 2000), ("--floor", int, None)]),
    "kick": (t_kick, [("--runs", int, 10), ("--ms", int, 400)]),
    "drive": (t_drive, [("--cm", int, 50), ("--kp", int, None)]),
    "turn": (t_turn, [("--deg", int, 90), ("--duty", int, None), ("--kick", int, None)]),
    "reflex": (t_reflex, [("--cm", int, 150)]),
    "cutoff": (t_cutoff, []),
    "drives": (t_drives, [("--cm", int, 50), ("--kps", str, "0,15,30"), ("--cruise", int, None), ("--lag", int, None)]),
    "turns": (t_turns, [("--deg", int, 90), ("--reps", int, 5), ("--duty", int, None), ("--kick", int, None)]),
    "soak": (t_soak, [("--minutes", float, 5.0)]),
    "battery": (t_battery, [("--duty", int, 30), ("--ms", int, 1000), ("--after", float, 2.0)]),
}


def interrupt(signum, frame):
    raise KeyboardInterrupt


def main():
    signal.signal(signal.SIGTERM, interrupt)
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="test", required=True)
    for name, (_, opts) in TESTS.items():
        sp = sub.add_parser(name)
        for flag, typ, default in opts:
            if default is REQUIRED:
                sp.add_argument(flag, type=typ, required=True)
            else:
                sp.add_argument(flag, type=typ, default=default)
    note = sub.add_parser("note")
    note.add_argument("for_test")
    note.add_argument("--mm", type=int, default=None)
    note.add_argument("--remark", default="")
    a = p.parse_args()
    if a.test == "note":
        record("note", vars(a), t_note(None, a))
        return
    s = Session()
    fn, _ = TESTS[a.test]
    try:
        record(a.test, {k: v for k, v in vars(a).items() if k != "test"}, fn(s, a))
    finally:
        try:
            s.mcu.stop()
        except Exception:
            pass


if __name__ == "__main__":
    main()
# 2026-11-06T04:20:00
# 2026-11-06T22:59:42
