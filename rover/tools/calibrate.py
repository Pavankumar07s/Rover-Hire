"""Phase 10A self-calibration suite (plan.md): measures what the rover's motion depends on, with its own sensors, on this
floor. Writes rover/core/calibration.json only when every stage passes, else calibration.candidate.json next to it.
On the UNO Q, the rover square to a wall or a big box 1.0-2.0 m ahead, 50 cm clear all round:
    venv/bin/python -m rover.tools.calibrate run --place home --go      S0-S6, about 5 min
    venv/bin/python -m rover.tools.calibrate check --place home --go    between missions: S0, S1, 4 turns, 1 drive; writes no values
    venv/bin/python -m rover.tools.calibrate wheels --go                wheels in the air: each side's free speed and current
    venv/bin/python -m rover.tools.calibrate orbit --place home --go    S6b, a round bucket 45 cm ahead: the orbit's pivot
At the venue, on top of the full run made at home (the floor changes grip and turn coast, not the rover):
    venv/bin/python -m rover.tools.calibrate check --place venue --go
    venv/bin/python -m rover.tools.calibrate run --stages S0,S3,S6 --apply --place venue --go
--apply writes each stage's values to calibration.json as soon as it passes, then goes on; a failed stage stops the run.
Without --go it prints what it needs and moves nothing. Evidence: evidence/CAL/<date>-<place>/, one JSONL per stage.
"""

import argparse
import copy
import json
import math
import os
import random
import shutil
import signal
import statistics
import subprocess
import time
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path

import cv2

from rover.core import calibration
from rover.core import skills as skills_mod
from rover.core.calibration import CALIBRATION_FILE, dumps
from rover.core.camera import CAMERA_FILE, LUMA_HI, LUMA_LO, Camera
from rover.core.mcu import FLAG_IMU_OK, McuError
from rover.core.skills import Skills
from rover.tools.floor_test import LEASE_MS, Session, board_temp_c

ROOT = Path(__file__).resolve().parents[2]
SERVICE_CAL = Path.home() / "0xbs-rover" / "rover" / "core" / "calibration.json"  # what rover.service pushes on start
CANDIDATE = CALIBRATION_FILE.with_name("calibration.candidate.json")
CAMERA = os.environ.get("CAMERA_DEVICE", "/dev/v4l/by-id/usb-046d_081b_68564B60-video-index0")
LSB_PER_DPS = 65.5

BATT_STOP_MV, BATT_WARN_MV, BOARD_STOP_C = 7400, 7800, 75
TARGET_MIN_MM, TARGET_MAX_MM, CLEAR_MM = 1000, 2000, 600
PULSE_PCT, PULSE_S, PULSE_EDGES, PULSE_DEG = 60, 0.3, 6, 2.0
RAMP_FROM, RAMP_STEP, RAMP_S = 20, 5, 0.4
DOWN_S, NEAR_STOP_MM = 0.2, CLEAR_MM + 200  # lowering the power covers ground: short steps, and stop early (42 cm)
TURN_TRY_PCTS, TURN_TRY_DEG, TURN_MARGIN = (55, 65, 75, 85, 100), 45, 15  # the test runs cold; missions warm the L298N
GRIP_MARGIN, TOO_GRIPPY_PCT = 15, 85
DRIFT_MAX_DEG_PER_50CM, KPS = 3.0, (0, 15, 30)
TURN_ANGLES, TURN_TOL_DEG = (15, 30, 45, 90, 135, 180), 3.0
TURN_PAUSE_S = 1.5  # the L298N heats over many turns in a row (0/10 90 deg turns after ~110 turns)
S6_PAUSE_S = 4.0  # with 1.5 s rests the 90 deg turn's peak fell from 175 to 86 deg/s after ~30 turns
FULL_SPEED_DEG, HOT_SHARE = 45, 0.6  # turns this big reach full speed; slower than 60 % of the first ones = a hot driver
ROLL_WILD_MM = 60  # right after S6 heated the L298N: 30 cm drives went 43.8 and 42.9 cm (a cool day before: 30.0)
RANDOM_CHECKS = 6  # 12 fit turns + 6 checks stay under the ~30 turns after which this L298N fades (twice)
ORBIT_LEGS, ORBIT_START_MM, ORBIT_SEEN_MM, ORBIT_TOO_CLOSE_MM = 5, 450, (150, 900), 250
ORBIT_FLAT_MM, PIVOT_STEP_MM, PIVOT_RANGE_MM = 30, 100, (0, 300)
HFOV_TURN_DEG, HFOV_TOL_DEG, HFOV_SPREAD_DEG, MATCH_MIN, TEXTURE_MIN = 10, 1.5, 1.5, 0.7, 8.0
ALL = ("S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7")


class Abort(Exception):
    """Ends the suite at once and writes nothing (plan: unplanned reflex, IMU reset, low battery, board heat, kill switch)."""


class StageFail(Exception):
    pass


# ---------- pure rules (rover/tests/test_calibrate.py) ----------

def wiring_problems(rows):
    """S1 floor pulses -> what is wrong, in words. rows[step] = {"l", "r": edges, "yaw": deg, "moved_mm": sonar}."""
    out = []
    for side, own, other, other_side, sign in (("left", "l", "r", "right", -1), ("right", "r", "l", "left", 1)):
        row = rows[side]
        turned = abs(row["yaw"]) >= PULSE_DEG
        if not turned and max(row["l"], row["r"]) < PULSE_EDGES:
            out.append(f"the {side} side does not move: its motor wires, its L298N output or its EN/IN pins")
            continue
        if row[own] < PULSE_EDGES and row[other] >= PULSE_EDGES:
            out.append(f"the encoders are swapped: the {side} side's edges arrive on the {other_side} input (left must be D2, right D4)")
        elif row[own] < PULSE_EDGES:
            out.append(f"the {side} encoder counts nothing while its side moves: its OUT wire or its pin")
        if not turned:
            out.append(f"the {side} wheels turn but the rover does not: they slip on this floor")
        elif row["yaw"] * sign < 0:
            out.append(f"the {side} side runs backward: swap its two motor wires at the L298N")
    if rows["both"]["moved_mm"] is not None and rows["both"]["moved_mm"] < -15:
        out.append("'both forward' moved the rover backward")
    for step, sign in (("spin_left", 1), ("spin_right", -1)):
        if rows[step]["yaw"] * sign < PULSE_DEG:
            out.append(f"{step.replace('_', ' ')} did not turn the rover that way")
    return out


def grip_values(drive_start, keep_rolling, turn_ok, cruise_pct):
    """S3: the drive's start and keep-rolling powers and the lowest turn power that finished both ways -> kick, floor,
    cruise and turn power, each with a margin, max 100."""
    floor = min(100, keep_rolling + 5)
    return {"kick_pct": min(100, drive_start + GRIP_MARGIN), "floor_pct": floor, "cruise_pct": max(cruise_pct, floor),
            "turn_pct": min(100, turn_ok + TURN_MARGIN), "turn_kick_pct": 100}


def trim_from(edges_l, edges_r, cruise_pct):
    """S4: power added to the slower side (> 0 left, < 0 right) so both front wheels roll alike in a kp 0 drive."""
    if not edges_l or not edges_r:
        return 0
    ratio = edges_l / edges_r
    if abs(ratio - 1) <= 0.03:
        return 0
    t = round(cruise_pct * (1 / ratio - 1)) if ratio < 1 else -round(cruise_pct * (ratio - 1))
    return max(-15, min(15, t))


def choose_kp(drives, trim):
    """S4: the smallest heading gain whose drive drifted under the limit; a kp 0 drive counts only when no trim is needed."""
    ok = [d for d in drives if d["drift_deg_per_50cm"] <= DRIFT_MAX_DEG_PER_50CM and (d["kp_x10"] > 0 or trim == 0)]
    return min(d["kp_x10"] for d in ok) if ok else None


def lead_fit(points, per_mm_now):
    """S5: drive_until overshoot vs travel, the P2 shape base + per_mm x travel. Travels far apart fit both; else base only."""
    ts, os_ = [t for t, _ in points], [o for _, o in points]
    per = per_mm_now
    if len(points) >= 3 and max(ts) - min(ts) >= 150:
        mt, mo = statistics.mean(ts), statistics.mean(os_)
        per = sum((t - mt) * (o - mo) for t, o in points) / sum((t - mt) ** 2 for t in ts)
        per = max(0.0, min(0.5, per))
    base = max(0, min(200, round(statistics.mean(o - per * t for t, o in points))))
    top = 5 * math.ceil(max(max(os_), base + per * max(ts)) / 5)
    rms = math.sqrt(statistics.mean((o - (base + per * t)) ** 2 for t, o in points))
    return base, round(per, 3), top, round(rms, 1)


def fit_brake(points):
    """S6: coast after the halt (cdeg) = K/1000 x rate + rate^2 / Q (rate in cdps), least squares; K, Q in firmware units."""
    srr = sum(r * r for r, _ in points)
    sr3 = sum(r ** 3 for r, _ in points)
    sr4 = sum(r ** 4 for r, _ in points)
    scr = sum(c * r for r, c in points)
    scr2 = sum(c * r * r for r, c in points)
    det = srr * sr4 - sr3 * sr3
    a = (scr * sr4 - scr2 * sr3) / det if det else 0.0
    b = (srr * scr2 - sr3 * scr) / det if det else 0.0
    if b < 1 / 5_000_000:
        b = 1 / 5_000_000
        a = (scr - b * sr3) / srr
    if a < 0:
        a = 0.0
        b = max(1 / 5_000_000, scr2 / sr4)
    k, q = max(0, min(500, round(a * 1000))), max(10_000, min(5_000_000, round(1 / b)))
    rms = math.sqrt(statistics.mean((c - (k * r / 1000 + r * r / q)) ** 2 for r, c in points)) / 100
    return k, q, round(rms, 2)


def wheel_findings(summary):
    """wheels -> (problems, notes). A dead side or encoder fails; a side over 10 % slower is named with the plan's hint."""
    problems, notes = [], []
    for r in summary:
        for side, other in (("left", "right"), ("right", "left")):
            mine, theirs = r[f"{side}_edges_per_s"], r[f"{other}_edges_per_s"]
            if mine == 0 and theirs > 0:
                problems.append(f"at {r['pct']} % the {side} encoder counts nothing: a dead side, or its encoder wire")
            elif mine < 0.9 * theirs:
                hint = ("it draws more current too: a stiff gearbox (run it in or oil it)" if r[f"{side}_dip_mv"] > r[f"{other}_dip_mv"]
                        else "it draws less current too: a bad contact (front-left)")
                notes.append(f"at {r['pct']} % the {side} side runs {round(100 * (1 - mine / theirs))} % slower than the {other}; {hint}")
    return problems, notes


def gap_trend(legs):
    """S6b: the gap's change per leg (mm, least squares) over the legs where the sonar saw the target; None under 3."""
    pts = [(l["leg"], l["gap_mm"]) for l in legs if l["gap_mm"] is not None]
    if len(pts) < 3:
        return None
    mx, my = statistics.mean(p for p, _ in pts), statistics.mean(g for _, g in pts)
    return round(sum((p - mx) * (g - my) for p, g in pts) / sum((p - mx) ** 2 for p, _ in pts), 1)


def pivot_for_flat(p1, c1, p2, c2):
    """S6b: the pivot where the gap stays flat, between two series. A bigger pivot plans a bigger circle and a longer leg,
    so the gap must grow faster with it; a change under 5 mm per leg, or the wrong way, says the pivot is not what moves it."""
    if c1 is None or c2 is None or p1 == p2:
        return None
    slope = (c2 - c1) / (p2 - p1)
    if slope <= 0 or abs(c2 - c1) < 5:
        return None
    return round(p1 - c1 / slope)


def bearing_after_turn(yaw_deg, depth_mm, pivot_mm):
    """S7: the bearing of a point that was straight ahead at depth_mm, after a turn of yaw_deg about a pivot pivot_mm
    behind the lens. The lens swings sideways as the rover turns, so a near point moves further than the turn."""
    t, reach = math.radians(abs(yaw_deg)), depth_mm + pivot_mm
    return math.degrees(math.atan2(reach * math.sin(t), reach * math.cos(t) - pivot_mm))


def hfov_from_shift(shift_px, yaw_deg, width_px, depth_mm, pivot_mm):
    """S7: pinhole x = f tan(bearing) for the point that was at the image centre, so f, then the horizontal field of view."""
    f = abs(shift_px) / math.tan(math.radians(bearing_after_turn(yaw_deg, depth_mm, pivot_mm)))
    return math.degrees(2 * math.atan(width_px / 2 / f))


def image_shift(before, after, half_w=64, half_h=80):
    """S7: how far (px, + = right) the middle of `before` sits in `after`, the match score and the patch's texture (grey
    level spread). The middle patch, not the whole frame: a turn moves the edges of a frame ~20 % more than its middle."""
    g1, g2 = (cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) if f.ndim == 3 else f for f in (before, after))
    h, w = g1.shape
    x0, y0 = w // 2 - half_w, h // 2 - half_h
    patch = g1[y0:y0 + 2 * half_h, x0:x0 + 2 * half_w]
    m = cv2.matchTemplate(g2, patch, cv2.TM_CCOEFF_NORMED)
    _, score, _, (mx, my) = cv2.minMaxLoc(m)
    sub = 0.0
    if 0 < mx < m.shape[1] - 1:
        a, b, c = m[my, mx - 1], m[my, mx], m[my, mx + 1]
        sub = 0.5 * (a - c) / (a - 2 * b + c) if a - 2 * b + c else 0.0
    return round(float(mx + sub - x0), 2), round(float(score), 3), round(float(patch.std()), 1)


# ---------- the rover ----------

class Suite:
    def __init__(self, place, kind):
        self.s = Session()
        self.mcu = self.s.mcu
        self.file = json.loads(CALIBRATION_FILE.read_text())
        self.base = self.cal = calibration.load()
        self.fit, self.notes, self.skills, self.skill_notes, self.camera = {}, {}, {}, {}, {}
        self.applied, self.backed_up = [], set()
        self.power, self.resets, self.cutoff = None, None, 7000
        self.place, self.day = place, datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self.out = ROOT / "evidence" / "CAL" / (f"{self.day}-{place}" + ("" if kind == "run" else f"-{kind}"))
        self.out.mkdir(parents=True, exist_ok=True)

    def push(self, **temp):
        self.cal = replace(self.base, **{**self.fit, **temp})
        self.mcu.set_cal(self.cal)

    def set(self, key, value, note):
        self.fit[key] = value
        self.notes[key] = note

    def log(self, stage, row):
        row = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **row}
        with open(self.out / f"{stage}.jsonl", "a") as f:
            f.write(json.dumps(row) + "\n")
        print(f"{stage}: {json.dumps({k: v for k, v in row.items() if k != 'at'})}", flush=True)

    def guard(self, st, stop=None, reflex_ok=False):
        if self.resets is not None and st["imu_resets"] != self.resets:
            raise Abort("the gyro reset: check its power and I2C wires")
        if stop == "imu":
            raise Abort("the firmware stopped on a gyro fault")
        if stop == "reflex" and not reflex_ok:
            raise Abort("an unplanned reflex stop: something is in front of the rover")
        if stop == "battery" or st["batt_mv"] < BATT_STOP_MV:
            # a loose sense wire reads ~2.3 V for a moment (a run-in: a battery stop with the pack at 8.48 V)
            rest = statistics.median(s["batt_now_mv"] for s in self.s.pump(1.0))
            if rest < BATT_STOP_MV:
                raise Abort(f"battery {rest / 1000:.2f} V at rest (the suite stops under {BATT_STOP_MV / 1000} V): charge it")
            if stop == "battery":
                raise Abort(f"a battery stop while the pack reads {rest / 1000:.2f} V at rest: the battery-sense wire (A0/GND) is loose")
        t = board_temp_c()
        if t is not None and t > BOARD_STOP_C:
            raise Abort(f"the board is at {t:.0f} C")

    def calibrate_imu(self):
        bias = self.mcu.imu_cal()
        self.s.next_hb = 0.0
        self.s.beat()
        return bias

    def motion(self, start, max_s=6.0, reflex_ok=False, drive=False):
        before = self.mcu.state()
        self.s.next_hb = 0.0
        self.s.beat()
        start()
        run = self.s.pump(max_s, renew=True, until=lambda st: st["mode_name"] in ("brake", "idle"))
        if run[-1]["mode_name"] not in ("brake", "idle"):
            self.mcu.stop()
            raise Abort("a motion did not end by itself")
        halt = self.mcu.halt_info()
        end = self.s.settle()
        stop = run[-1]["stop_name"]
        self.guard(end, stop, reflex_ok)
        l0, r0 = (0, 0) if drive else (before["enc_l"], before["enc_r"])
        return {"stop": stop, "yaw_deg": round((end["yaw_cdeg"] - before["yaw_cdeg"]) / 100, 2),
                "edges_l": end["enc_l"] - l0, "edges_r": end["enc_r"] - r0,
                "peak_dps": round(max(abs(x["rate_cdps"]) for x in run) / 100, 1),
                "elapsed_ms": run[-1]["halt_ms"] - run[-1]["start_ms"], "batt_min_mv": end["batt_min_mv"],
                "halt_rate_cdps": abs(halt["rate_cdps"]), "halt_yaw_cdeg": halt["yaw_cdeg"], "end_yaw_cdeg": end["yaw_cdeg"],
                "run": run}

    def turn(self, deg):
        r = self.motion(lambda: self.mcu.turn_deg(deg, LEASE_MS))
        sign = 1 if deg > 0 else -1
        r["coast_cdeg"] = (r["end_yaw_cdeg"] - r["halt_yaw_cdeg"]) * sign
        r["error_deg"] = round(r["yaw_deg"] * sign - abs(deg), 2)
        return r

    def sonar(self, seconds=1.5):
        """The median distance over `seconds`: at 1-2 m single pings wander ~70 mm (a flat wall at 1.5 m); 1.5 s of
        pings holds the median within ~9 mm."""
        vals = [st["sonar_mm"] for st in self.s.pump(seconds) if st["sonar_mm"] >= 0]
        return int(statistics.median(vals)) if vals else None

    def room(self, travel_mm):
        d = self.sonar()
        if d is None or d - travel_mm < CLEAR_MM:
            raise StageFail(f"needs {travel_mm} mm of travel and 60 cm left in front; the sonar reads {d} mm: move the rover back")
        return d

    def face(self, yaw0):
        for _ in range(3):
            off = (yaw0 - self.mcu.state()["yaw_cdeg"]) / 100
            if abs(off) < 3:
                return
            self.motion(lambda o=int(round(max(-360, min(360, off)))): self.mcu.turn_deg(o, LEASE_MS))
            time.sleep(0.5)

    def home(self, start_mm, yaw0):
        """Back to where the stage began: the heading by the gyro, the distance by the sonar."""
        self.face(yaw0)
        now = self.sonar()
        if start_mm is not None and now is not None and start_mm - now > 20:
            self.back(start_mm - now)
            self.face(yaw0)

    def back(self, mm):
        cm = min(200, int(round(mm / 10)))
        if cm >= 2:
            self.motion(lambda: self.mcu.drive_cm(-cm, 0, LEASE_MS), max_s=10, drive=True)

    def pulse(self, l, r):
        before, s0 = self.mcu.state(), self.sonar(0.4)
        self.s.next_hb = 0.0
        self.s.beat()
        self.mcu.set_duty(l, r, LEASE_MS)
        self.s.pump(PULSE_S)
        self.mcu.stop()
        end = self.s.settle()
        self.guard(end, end["stop_name"])
        s1 = self.sonar(0.4)
        return {"duty": [l, r], "l": end["enc_l"] - before["enc_l"], "r": end["enc_r"] - before["enc_r"],
                "yaw": round((end["yaw_cdeg"] - before["yaw_cdeg"]) / 100, 1),
                "moved_mm": None if s0 is None or s1 is None else s0 - s1}


class SkillsWorker:
    """What the mission's Skills expect of McuWorker, over the suite's own MCU session, so S6b runs the real orbit_leg:
    a heartbeat with every call, and a stalled turn's boost changes only the turn powers on top of the suite's values."""

    def __init__(self, x):
        self.x = x

    def call(self, method, *args, timeout=None):
        self.x.s.beat()
        if method == "set_cal":
            cal = args[0]
            return self.x.push() if cal == calibration.load() else self.x.push(turn_pct=cal.turn_pct, turn_kick_pct=cal.turn_kick_pct)
        return getattr(self.x.mcu, method)(*args)


def result(summary, problems=(), warnings=()):
    return {"pass": not problems, "summary": summary, "problems": list(problems), "warnings": list(warnings)}


# ---------- stages ----------

def s0(x):
    """Preflight, no motion."""
    info = x.mcu.info()
    if "brake_k=" not in info:
        return result({"info": info}, ["the firmware is older than the suite: flash it (ROVER_DIR=... rover/tools/deploy.sh --flash)"])
    x.push()
    problems, warnings = [], []
    try:
        bias = x.calibrate_imu()
    except McuError as e:
        return result({"info": info}, [f"the gyro would not calibrate ({e}): keep the rover still, check its wires"])
    still = x.s.pump(3.0)
    a, b = still[0], still[-1]
    x.resets = b["imu_resets"]
    secs = max((b["ms"] - a["ms"]) / 1000, 1e-3)
    batt = statistics.median(st["batt_now_mv"] for st in still)
    readings, lost = pings(x, 60)
    target = int(statistics.median(readings)) if readings else None
    spread = max(readings) - min(readings) if readings else None
    temp = board_temp_c()
    free_mb = shutil.disk_usage(Path.home()).free // 1_000_000
    m = {"info": info, "batt_mv": batt, "gyro_bias_dps": round(abs(bias) / 100 / LSB_PER_DPS, 2),
         "gyro_drift_dps": round(abs(b["yaw_cdeg"] - a["yaw_cdeg"]) / 100 / secs, 3), "gyro_ok": bool(b["flags"] & FLAG_IMU_OK),
         "gyro_resets_while_still": b["imu_resets"] - a["imu_resets"], "edges_at_rest": [b["enc_l"] - a["enc_l"], b["enc_r"] - a["enc_r"]],
         "sonar_mm": target, "sonar_spread_mm": spread, "sonar_lost": lost, "camera": Path(CAMERA).exists(),
         "board_c": temp, "free_mb": free_mb}
    if batt < BATT_STOP_MV:
        problems.append(f"battery {batt / 1000:.2f} V: charge it")
    elif batt < BATT_WARN_MV:
        warnings.append(f"battery {batt / 1000:.2f} V, under {BATT_WARN_MV / 1000} V")
    if m["gyro_bias_dps"] > 5 or m["gyro_drift_dps"] > 0.5 or not m["gyro_ok"] or m["gyro_resets_while_still"]:
        problems.append("the gyro is not steady: keep the rover still and check the gyro's wires")
    if any(m["edges_at_rest"]):
        problems.append("an encoder counts while the rover stands still: a loose encoder wire picks up noise")
    if lost or spread is None or spread > 10:
        problems.append(f"the sonar is not steady ({lost} lost of 60, spread {spread} mm): aim it square at a flat target")
    if target is None or not TARGET_MIN_MM <= target <= TARGET_MAX_MM:
        problems.append(f"put a wall or a big box 1.0-2.0 m straight ahead (the sonar reads {target} mm)")
    if not m["camera"]:
        problems.append("the camera is missing (after a boot the USB-C port can turn to 'device': set its role to host)")
    if temp is not None and temp > BOARD_STOP_C:
        problems.append(f"the board is at {temp:.0f} C")
    if free_mb < 200:
        problems.append(f"only {free_mb} MB free on the board")
    return result(m, problems, warnings)


def pings(x, n):
    readings, lost, last = [], 0, x.mcu.state()["pings"]
    end = time.monotonic() + 15
    while len(readings) + lost < n and time.monotonic() < end:
        x.s.beat()
        st = x.mcu.state()
        if st["pings"] != last:
            last = st["pings"]
            if st["sonar_raw_mm"] < 0:
                lost += 1
            else:
                readings.append(st["sonar_raw_mm"])
        time.sleep(0.02)
    return readings, lost


S1_STEPS = (("left", 1, 0), ("right", 0, 1), ("both", 1, 1), ("spin_left", -1, 1), ("spin_right", 1, -1))


def s1(x):
    """Wiring and direction: short pulses on the floor; the encoders say which wheels turned, the gyro which way."""
    x.push()
    yaw0, start = x.mcu.state()["yaw_cdeg"], x.sonar()
    rows = {}
    for step, l, r in S1_STEPS:
        for pct in (PULSE_PCT, 100):  # one side alone or a spin may not start at 60 % on a grippy floor
            row = {**x.pulse(l * pct, r * pct), "pct": pct}
            clear = ((row["moved_mm"] or 0) >= 15) if step == "both" else abs(row["yaw"]) >= PULSE_DEG
            if clear:
                break
        rows[step] = row
        x.log("S1", {"step": step, **row})
        time.sleep(0.5)
    x.home(start, yaw0)
    return result({k: {kk: v[kk] for kk in ("pct", "l", "r", "yaw", "moved_mm")} for k, v in rows.items()}, wiring_problems(rows))


def s2(x):
    """Power under load: the battery's low point in 1 s of spinning at 30 / 60 / 100 %, against its rest reading."""
    x.push()
    yaw0, start = x.mcu.state()["yaw_cdeg"], x.sonar()
    rows = []
    for pct in (30, 60, 100):
        rest = statistics.median(st["batt_now_mv"] for st in x.s.pump(0.6))
        x.s.next_hb = 0.0
        x.s.beat()
        x.mcu.set_duty(-pct, pct, LEASE_MS)
        a = x.s.pump(0.5)
        x.mcu.set_duty(pct, -pct, LEASE_MS)
        b = x.s.pump(0.5)
        x.mcu.stop()
        x.guard(x.s.settle())
        load = [st["batt_now_mv"] for st in a + b]
        mid = statistics.median(load[len(load) // 4:])
        rows.append({"pct": pct, "rest_mv": rest, "load_mv": mid, "low_mv": min(load), "sag_mv": rest - mid})
        x.log("S2", rows[-1])
        time.sleep(1.0)
    x.home(start, yaw0)
    full = rows[-1]
    problems, warnings = [], []
    worst = min(rows, key=lambda r: r["low_mv"])
    if full["sag_mv"] > 800:
        problems.append(f"the pack sags {full['sag_mv'] / 1000:.2f} V at full power: a weak pack or a loose power contact")
    if worst["low_mv"] < x.cutoff + 300:
        if worst["low_mv"] < worst["load_mv"] - 1500:
            problems.append(f"the battery reading dropped to {worst['low_mv'] / 1000:.2f} V for a moment while the pack held "
                            f"{worst['load_mv'] / 1000:.2f} V: a loose battery-sense wire (A0/GND) or battery contact")
        else:
            problems.append(f"the pack falls to {worst['low_mv'] / 1000:.2f} V at {worst['pct']} %, too near the {x.cutoff / 1000} V cutoff: charge it")
    before = (x.file.get("suite") or {}).get("power")
    if before and full["sag_mv"] > 1.5 * before["sag_100_mv"] + 150:
        warnings.append(f"the sag at full power is {full['sag_mv']} mV, against {before['sag_100_mv']} mV on {before['date']}")
    x.power = {"date": x.day, "sag_100_mv": full["sag_mv"], "low_100_mv": full["low_mv"], "rest_mv": full["rest_mv"]}
    return result({"rows": rows}, problems, warnings)


def ramp(x, l, r, started, stop_near=False, near_mm=CLEAR_MM):
    """Power up from RAMP_FROM in RAMP_STEP steps of RAMP_S until started(step) says the rover moves. Leaves it running."""
    pct, rows = RAMP_FROM, []
    x.s.next_hb = 0.0
    while pct <= 100:
        st0 = x.mcu.state()
        x.s.beat()
        x.mcu.set_duty(l * pct, r * pct, LEASE_MS)
        seg = x.s.pump(RAMP_S, until=(lambda st: 0 <= st["sonar_mm"] < near_mm) if stop_near else None)
        st1 = seg[-1]
        if st1["mode_name"] != "duty":
            x.mcu.stop()
            x.guard(x.s.settle(), st1["stop_name"])
        tail = seg[len(seg) // 2:]
        row = {"pct": pct, "l": st1["enc_l"] - st0["enc_l"], "r": st1["enc_r"] - st0["enc_r"],
               "rate_dps": round(statistics.median(abs(s["rate_cdps"]) for s in tail) / 100, 1)}
        row["slip"] = min(row["l"], row["r"]) >= PULSE_EDGES and row["rate_dps"] < 3 and l != r
        rows.append(row)
        if started(row) or (stop_near and 0 <= st1["sonar_mm"] < near_mm):
            return pct if started(row) else None, rows
        pct += RAMP_STEP
    return None, rows


def s3(x):
    """Floor grip: the lowest power that starts a drive and keeps it rolling, and the lowest turn power that finishes."""
    x.push()
    yaw0 = x.mcu.state()["yaw_cdeg"]
    before = x.room(400)
    drive_start, up = ramp(x, 1, 1, lambda row: row["l"] >= 3 and row["r"] >= 3, stop_near=True, near_mm=NEAR_STOP_MM)
    keep, down = drive_start, []
    if drive_start:
        pct = drive_start - RAMP_STEP
        while pct >= RAMP_FROM:
            st0 = x.mcu.state()
            x.s.beat()
            x.mcu.set_duty(pct, pct, LEASE_MS)
            seg = x.s.pump(DOWN_S, until=lambda st: 0 <= st["sonar_mm"] < NEAR_STOP_MM)
            row = {"pct": pct, "l": seg[-1]["enc_l"] - st0["enc_l"], "r": seg[-1]["enc_r"] - st0["enc_r"]}
            down.append(row)
            if row["l"] < 2 or row["r"] < 2 or 0 <= seg[-1]["sonar_mm"] < NEAR_STOP_MM:
                break
            keep = pct
            pct -= RAMP_STEP
    x.mcu.stop()
    x.guard(x.s.settle())
    after = x.sonar()
    moved = None if before is None or after is None else before - after
    x.log("S3", {"step": "drive", "start_pct": drive_start, "keep_rolling_pct": keep, "moved_mm": moved, "up": up, "down": down})
    x.back(moved or 0)
    x.face(yaw0)
    # Turns as missions make them (a 100 % kick, then the turn power), not a slow duty ramp: the ramp held the wheels
    # stalled for 6 s and spun nothing even at 100 %, while a spin from rest at 100 % turned 105 deg in 0.5 s.
    turn_ok, tries = None, []
    for pct in TURN_TRY_PCTS:
        x.push(turn_pct=pct, turn_kick_pct=100)
        turns = []
        for deg in (TURN_TRY_DEG, -TURN_TRY_DEG):
            r = x.turn(deg)
            turns.append({"deg": deg, "stop": r["stop"], "yaw_deg": r["yaw_deg"], "peak_dps": r["peak_dps"]})
            time.sleep(TURN_PAUSE_S)
        tries.append({"turn_pct": pct, "turns": turns})
        x.log("S3", {"step": "turns", "turn_pct": pct, "turns": turns})
        if all(t["stop"] == "done" for t in turns):
            turn_ok = pct
            break
    x.push()
    x.face(yaw0)
    problems, warnings = [], []
    if drive_start is None:
        problems.append("a drive does not start even at 100 %")
    elif moved is not None and moved < 30:
        problems.append(f"the wheels turned but the rover moved only {moved} mm: they slip on this floor")
    if turn_ok is None:
        problems.append("45 deg turns stall even at 100 %: the floor grips too hard, or the motor driver is hot")
    elif turn_ok >= TOO_GRIPPY_PCT:
        warnings.append(f"turns need {turn_ok} % to finish: a grippy floor, tape the rear tyres or use the demo mat")
    summary = {"drive_start_pct": drive_start, "keep_rolling_pct": keep, "turn_ok_pct": turn_ok, "turn_tries": tries}
    if not problems:
        values = grip_values(drive_start, keep, turn_ok, x.cal.cruise_pct)
        why = {"kick_pct": f"drive starts at {drive_start} % + {GRIP_MARGIN}",
               "floor_pct": f"a drive keeps rolling down to {keep} % + 5",
               "cruise_pct": f"at least floor_pct (was {x.cal.cruise_pct})",
               "turn_pct": f"45 deg turns both ways finish at {turn_ok} % (tried {[t['turn_pct'] for t in tries]}), + {TURN_MARGIN}",
               "turn_kick_pct": "100: a lower kick left turns humming in place"}
        for k, v in values.items():
            x.set(k, v, f"S3 floor grip: {why[k]}")
        summary["values"] = values
    return result(summary, problems, warnings)


def steady_edges_per_s(run):
    drive = [s for s in run if s["mode_name"] == "drive"]
    if len(drive) < 4:
        return None
    half = drive[len(drive) // 2:]
    secs = (half[-1]["ms"] - half[0]["ms"]) / 1000
    e = lambda s: (s["enc_l"] + s["enc_r"]) / 2
    return round((e(half[-1]) - e(half[0])) / secs, 1) if secs >= 0.15 else None


def s4(x):
    """Straight drive: true distance by the sonar, edges per mm, cruise speed, heading drift per kp, side trim, roll, back-off."""
    yaw0 = x.mcu.state()["yaw_cdeg"]
    drives, trim, problems = [], 0, []
    for kp in KPS:
        x.push(kp_x10=kp, trim_pct=trim)
        before = x.room(350)
        ms = min(1500, int((before - CLEAR_MM - 100) / max(x.cal.cruise_mm_s, 100) * 1000))  # ~100 mm roll after the stop
        r = x.motion(lambda: x.mcu.drive_ms(ms, 0, LEASE_MS), max_s=ms / 1000 + 3, drive=True)
        after = x.sonar()
        moved = before - after
        edges = (r["edges_l"] + r["edges_r"]) / 2
        row = {"kp_x10": kp, "trim_pct": trim, "ms": ms, "moved_mm": moved, "edges_l": r["edges_l"], "edges_r": r["edges_r"],
               "mm_per_edge": round(moved / edges, 3) if edges else None, "steady_edges_per_s": steady_edges_per_s(r["run"]),
               "yaw_deg": r["yaw_deg"], "drift_deg_per_50cm": round(abs(r["yaw_deg"]) * 500 / max(moved, 1), 2), "stop": r["stop"]}
        drives.append(row)
        x.log("S4", {"step": "drive_ms", **row})
        if kp == 0:
            trim = trim_from(r["edges_l"], r["edges_r"], x.cal.cruise_pct)
        x.back(moved)
        x.face(yaw0)
    per_edge = [d["mm_per_edge"] for d in drives if d["mm_per_edge"]]
    speeds = [d["steady_edges_per_s"] for d in drives if d["steady_edges_per_s"]]
    if len(per_edge) < 3 or max(per_edge) / min(per_edge) - 1 > 0.05:
        problems.append(f"the three drives disagree on mm per edge ({per_edge}) by more than 5 %: wheel slip or a loose encoder")
    kp = choose_kp(drives, trim)
    if kp is None:
        problems.append(f"every drive drifted over {DRIFT_MAX_DEG_PER_50CM} deg per 50 cm: {[d['drift_deg_per_50cm'] for d in drives]}")
    if problems or not speeds:
        return result({"drives": drives}, problems or ["no steady cruise speed was measured"])
    mpe = statistics.median(per_edge)
    x.set("mm_per_edge_x100", round(mpe * 100), f"S4 straight drive: sonar distance / mean front-wheel edges over 3 drives = {per_edge}")
    x.set("cruise_mm_s", round(statistics.median(speeds) * mpe), f"S4: steady edges/s {speeds} x {mpe:.3f} mm per edge")
    x.set("kp_x10", kp, f"S4: drift per 50 cm at kp 0/15/30 = {[d['drift_deg_per_50cm'] for d in drives]} deg")
    x.set("trim_pct", trim, f"S4: kp 0 drive edges left {drives[0]['edges_l']} / right {drives[0]['edges_r']}")
    roll = x.cal.roll_ms
    overs, wild = [], False
    for i in range(3):
        x.push()
        before = x.room(300)
        x.motion(lambda: x.mcu.drive_cm(30, 0, LEASE_MS), max_s=8, drive=True)
        moved = before - x.sonar()
        overs.append(moved - 300)
        x.log("S4", {"step": "drive_cm_30", "roll_ms": x.cal.roll_ms, "moved_mm": moved})
        x.back(moved)
        x.face(yaw0)
        if i == 1:
            if abs(statistics.mean(overs)) > ROLL_WILD_MM:
                wild = True
                problems.append(f"drive_cm(30) went {[300 + o for o in overs]} mm, far from 30 cm: the motor driver may be hot "
                                "(a hot L298N brakes weakly); let it cool 15 min and run S4 again")
                break
            roll = max(0, min(1000, round(x.cal.roll_ms + statistics.mean(overs) * 1000 / x.fit["cruise_mm_s"])))
            x.set("roll_ms", roll, f"S4: drive_cm(30) went {[300 + o for o in overs]} mm at roll {x.cal.roll_ms} ms")
    if not wild and abs(overs[-1]) > 30:
        problems.append(f"drive_cm(30) went {300 + overs[-1]} mm with roll {roll} ms (allowed 270-330)")
    before = x.sonar()
    x.motion(lambda: x.mcu.drive_cm(-20, 0, LEASE_MS), max_s=8, drive=True)
    backed = x.sonar() - before
    x.log("S4", {"step": "back_off_20", "moved_mm": backed})
    if abs(backed - 200) > 30:
        problems.append(f"drive_cm(-20) went {backed} mm (allowed 170-230)")
    summary = {"drives": drives, "mm_per_edge": mpe, "kp_x10": kp, "trim_pct": trim, "roll_ms": roll,
               "drive_cm_30_mm": [300 + o for o in overs], "back_off_mm": backed}
    return result(summary, problems)


def s5(x):
    """Braking and sonar lead: how far drive_until runs past its stop distance; one reflex stop towards the target."""
    x.push()
    yaw0 = x.mcu.state()["yaw_cdeg"]
    points, problems = [], []
    for stop_mm in (400, 600, 400, 600):
        before = x.sonar()
        if before is None or before < stop_mm + 250:
            raise StageFail(f"too close for a drive_until to {stop_mm} mm (the sonar reads {before} mm): move the rover back")
        cap = min(200, (before - stop_mm) // 10 + 20)
        r = x.motion(lambda: x.mcu.drive_until(cap, stop_mm, LEASE_MS), max_s=10, drive=True)
        after = x.sonar()
        points.append((before - stop_mm, stop_mm - after))
        x.log("S5", {"step": "drive_until", "stop_mm": stop_mm, "start_mm": before, "end_mm": after, "stop": r["stop"]})
        if r["stop"] != "sonar":
            problems.append(f"drive_until {stop_mm} ended by '{r['stop']}', not the sonar")
        x.back(before - after)
        x.face(yaw0)
    base, per, top, rms = lead_fit(points, (x.file["skills"])["sonar_lead_per_mm"])
    before = x.sonar()
    r = x.motion(lambda: x.mcu.drive_cm(min(200, before // 10), 0, LEASE_MS), max_s=10, reflex_ok=True, drive=True)
    gap = x.sonar()
    x.log("S5", {"step": "reflex", "start_mm": before, "gap_mm": gap, "stop": r["stop"]})
    x.back(before - gap)
    x.face(yaw0)
    if r["stop"] != "reflex":
        problems.append(f"the reflex test ended by '{r['stop']}', not the reflex")
    elif gap < 120:
        problems.append(f"the reflex stopped {gap} mm from the target (needs >= 120)")
    if rms > 25:
        problems.append(f"the sonar lead fit is loose (rms {rms} mm over {points})")
    if not problems:
        why = f"S5 drive_until (travel, overshoot) mm = {points}, rms {rms} mm"
        for k, v in (("sonar_lead_base_mm", base), ("sonar_lead_per_mm", per), ("sonar_lead_max_mm", top)):
            x.skills[k], x.skill_notes[k] = v, why
    return result({"points": points, "base": base, "per_mm": per, "max": top, "rms_mm": rms, "reflex_gap_mm": gap}, problems)


def heat_check(peaks, deg, r):
    """Aborts when a full-speed turn runs much slower than the first ones did: the L298N is fading with heat."""
    if abs(deg) < FULL_SPEED_DEG or r["stop"] != "done":
        return
    if len(peaks) >= 3 and r["peak_dps"] < HOT_SHARE * max(peaks[:3]):
        raise Abort(f"the turns are slowing down ({deg} deg peaked {r['peak_dps']} deg/s, the first ones {max(peaks[:3])}): "
                    "the motor driver is hot, let it cool 15 min (a fan on the L298N helps)")
    peaks.append(r["peak_dps"])


def s6(x):
    """Turns: coast after braking vs the yaw rate at braking, fitted as K x rate + rate^2 / Q; then 6 random turns."""
    x.push()
    yaw0, start = x.mcu.state()["yaw_cdeg"], x.sonar()
    rows, peaks = [], []
    for a in TURN_ANGLES:
        for sign in (1, -1):
            r = x.turn(sign * a)
            rows.append({"deg": sign * a, **{k: r[k] for k in ("stop", "yaw_deg", "error_deg", "peak_dps", "halt_rate_cdps", "coast_cdeg")}})
            x.log("S6", {"step": "fit", **rows[-1]})
            heat_check(peaks, sign * a, r)
            time.sleep(S6_PAUSE_S)
    done = [r for r in rows if r["stop"] == "done"]
    stalls = sum(r["stop"] == "stall" for r in rows)
    problems = []
    if stalls > 2:
        problems.append(f"{stalls} of {len(rows)} turns stalled at {x.cal.turn_pct} %: the floor grips harder, or the driver is hot")
    if len(done) < 8:
        return result({"rows": rows}, problems or ["too few finished turns to fit"])
    k, q, rms = fit_brake([(r["halt_rate_cdps"], r["coast_cdeg"]) for r in done])
    x.set("turn_brake_k_x1000", k, f"S6: coast after braking vs yaw rate at braking over {len(done)} turns of 15-180 deg, rms {rms} deg")
    x.set("turn_brake_q_div", q, "see turn_brake_k_x1000")
    x.push()
    x.face(yaw0)
    seed = int(time.time())
    rng = random.Random(seed)
    checks = []
    for _ in range(RANDOM_CHECKS):  # judged by where they land: a check turn at 93 deg/s still landed within 0.3 deg
        deg = rng.randint(10, 180) * rng.choice((1, -1))
        r = x.turn(deg)
        checks.append({"deg": deg, "stop": r["stop"], "error_deg": r["error_deg"], "peak_dps": r["peak_dps"]})
        x.log("S6", {"step": "random", **checks[-1]})
        time.sleep(S6_PAUSE_S)
    x.home(start, yaw0)
    bad = [c for c in checks if c["stop"] != "done" or abs(c["error_deg"]) > TURN_TOL_DEG]
    if rms > 1.5:
        problems.append(f"the brake rule fits loosely (rms {rms} deg)")
    if bad:
        problems.append(f"{len(bad)} of {RANDOM_CHECKS} random turns missed by more than {TURN_TOL_DEG} deg or stalled: {bad}")
    return result({"k_x1000": k, "q_div": q, "rms_deg": rms, "stalls": stalls, "seed": seed, "random": checks}, problems)


def still_frame(x, cam):
    """A frame exposed after the rover came to rest (the heartbeat keeps going while it waits)."""
    x.s.pump(0.3)
    return cam._frames(1, skip=3)[0]


def s7(x):
    """Camera: exposure and white balance under this light, and the field of view from 10 deg gyro turns."""
    x.push()
    yaw0 = x.mcu.state()["yaw_cdeg"]
    pivot = calibration.skill_value("pivot_behind_front_mm")  # the lens sits at the front, by the sonar
    hfov_now = json.loads(CAMERA_FILE.read_text())["values"]["hfov_deg"]
    cam = Camera(CAMERA).start()
    rows, problems, warnings = [], [], []
    try:
        end = time.monotonic() + 30
        while cam.latest()[0] is None:
            if time.monotonic() > end:
                raise StageFail("the camera gives no frames (after a boot the USB-C port can turn to 'device': set its role to host)")
            x.s.pump(0.2)
        light = cam.autocalibrate()
        for deg in (HFOV_TURN_DEG, -HFOV_TURN_DEG, -HFOV_TURN_DEG, HFOV_TURN_DEG):  # left, back, right, back
            depth = x.sonar()
            before = still_frame(x, cam)
            r = x.turn(deg)
            after = still_frame(x, cam)
            shift, score, texture = image_shift(before, after)
            row = {"deg": deg, "stop": r["stop"], "yaw_deg": r["yaw_deg"], "depth_mm": depth, "shift_px": shift, "score": score,
                   "texture": texture, "hfov_deg": None}
            row["why_not"] = (f"the turn ended by '{r['stop']}'" if r["stop"] != "done" else
                              "the sonar sees nothing ahead" if not depth else
                              "a plain view, nothing to match" if texture < TEXTURE_MIN else
                              f"match score {score}" if score < MATCH_MIN else
                              "the picture moved the wrong way for the turn (mirrored image?)" if shift * deg <= 0 else None)
            if row["why_not"] is None:
                row["hfov_deg"] = round(hfov_from_shift(shift, r["yaw_deg"], before.shape[1], depth, pivot), 2)
            rows.append(row)
            x.log("S7", {"step": "turn", **row})
            if deg == HFOV_TURN_DEG and row["hfov_deg"] is not None:
                cv2.imwrite(str(x.out / "S7_before.jpg"), before)
                cv2.imwrite(str(x.out / "S7_after.jpg"), after)
            time.sleep(0.5)
    finally:
        cam.stop()
    x.face(yaw0)
    if not LUMA_LO <= light["luma"] <= LUMA_HI:
        warnings.append(f"the picture's brightness is {light['luma']} at gain {light['gain']} (wanted {LUMA_LO}-{LUMA_HI}): "
                        "more light on the parcel helps 0G read it")
    for why in dict.fromkeys(r["why_not"] for r in rows if r["why_not"]):
        n = sum(r["why_not"] == why for r in rows)
        problems.append(f"{n} of 4 turns: {why}" + (" (face something with a pattern 1-2 m ahead: a poster, a printed box)"
                                                    if "match" in why else ""))
    found = [r["hfov_deg"] for r in rows if r["hfov_deg"] is not None]
    hfov = round(statistics.median(found), 1) if found else None
    summary = {"light": light, "hfov_deg": hfov, "hfov_was": hfov_now, "pivot_mm": pivot, "turns": rows}
    if found and max(found) - min(found) > HFOV_SPREAD_DEG:
        problems.append(f"the 4 turns disagree on the field of view ({found} deg)")
    if not problems:
        if abs(hfov - hfov_now) > HFOV_TOL_DEG:
            warnings.append(f"the field of view is {hfov} deg, not {hfov_now}: the new value is stored")
            x.camera["hfov_deg"] = (hfov, f"S7: 10 deg gyro turns, middle patch matched between still frames, lens "
                                          f"{pivot} mm ahead of the pivot; per turn {found} deg")
    return result(summary, problems, warnings)


STAGES = {"S0": s0, "S1": s1, "S2": s2, "S3": s3, "S4": s4, "S5": s5, "S6": s6, "S7": s7}


def target_gap(x, sk):
    """S6b: the sonar's reading of the target after a leg; when straight ahead misses it, the nearest of a +-10 deg sweep."""
    ahead = x.sonar(0.6)
    if ahead is not None and ORBIT_SEEN_MM[0] <= ahead <= ORBIT_SEEN_MM[1]:
        return ahead, [ahead]
    reads = [ahead]
    for deg in (10, -20, 10):
        r = sk.turn(deg, correct=False)
        x.guard(x.mcu.state(), r.get("stop_reason"))
        reads.append(x.sonar(0.6))
    seen = [r for r in reads if r is not None and ORBIT_SEEN_MM[0] <= r <= ORBIT_SEEN_MM[1]]
    return (min(seen) if seen else None), reads


def leg_checked(x, res):
    """Every move in an orbit leg passes the suite's guard; a turn still stalled after the 100 % boost ends the run."""
    for step in res["steps"]:
        if step.get("skipped"):
            continue
        x.guard(x.mcu.state(), step.get("stop_reason"))
        if step.get("stop_reason") == "stall":
            raise Abort("a turn stalled even at 100 %: the motor driver is hot, let it cool 15 min (a fan on the L298N helps)")
    return sum(len(s.get("boosts") or []) for s in res["steps"])


def orbit_series(x, sk, pivot, direction="right"):
    """S6b: ORBIT_LEGS real orbit legs with orbit_leg planning on `pivot`, from ORBIT_START_MM; the gap after each leg."""
    skills_mod.skill_value = lambda name: pivot if name == "pivot_behind_front_mm" else calibration.skill_value(name)
    g, reads = target_gap(x, sk)
    if g is None:
        raise StageFail(f"the sonar cannot see the target ({reads} mm): a round bucket 45 cm straight ahead")
    if abs(g - ORBIT_START_MM) > 30:
        x.motion(lambda: x.mcu.drive_cm(round((g - ORBIT_START_MM) / 10), 0, LEASE_MS), max_s=8, reflex_ok=True, drive=True)
        g, reads = target_gap(x, sk)
    legs, boosts = [{"leg": 0, "gap_mm": g, "reads": reads}], 0
    x.log("S6b", {"pivot_mm": pivot, **legs[0]})
    for n in range(1, ORBIT_LEGS + 1):
        res = sk.orbit_leg(direction, remembered_gap_mm=legs[-1]["gap_mm"] or ORBIT_START_MM)
        boosts += leg_checked(x, res)
        if res["blocked"]:
            raise StageFail(f"something is {res['path_mm']} mm away along the leg: the orbit needs 1.6 m clear round the target")
        time.sleep(TURN_PAUSE_S)
        g, reads = target_gap(x, sk)
        legs.append({"leg": n, "gap_mm": g, "reads": reads, "planned_mm": res["gap_mm"], "planned_from": res["gap_from"],
                     "leg_cm": res["leg_cm"], "net_deg": round(res["net_cdeg"] / 100, 1)})
        x.log("S6b", {"pivot_mm": pivot, **legs[-1]})
        if g is not None and g < ORBIT_TOO_CLOSE_MM:
            break
    return {"pivot_mm": pivot, "per_leg_mm": gap_trend(legs), "gaps_mm": [l["gap_mm"] for l in legs], "boosts": boosts}


def s6b(x):
    """Orbit circle: the pivot point that keeps the gap to a round target flat over 5 orbit legs."""
    x.push()
    sk = Skills(SkillsWorker(x), None, lambda: (True, None), 0)
    now = calibration.skill_value("pivot_behind_front_mm")
    series, problems = [], []
    try:
        a = orbit_series(x, sk, now)
        series.append(a)
        if a["per_leg_mm"] is None:
            return result({"series": series}, ["the sonar saw the target after too few legs: use a round bucket 25-30 cm across"])
        b = orbit_series(x, sk, now + PIVOT_STEP_MM if a["per_leg_mm"] < 0 else max(0, now - PIVOT_STEP_MM))
        series.append(b)
        best = pivot_for_flat(a["pivot_mm"], a["per_leg_mm"], b["pivot_mm"], b["per_leg_mm"])
        if best is None:
            return result({"series": series}, [f"the gap's change per leg ({a['per_leg_mm']} at {a['pivot_mm']} mm, {b['per_leg_mm']} "
                                               f"at {b['pivot_mm']} mm) does not follow the pivot: turn errors or wheel slip move it"])
        if not PIVOT_RANGE_MM[0] <= best <= PIVOT_RANGE_MM[1]:
            return result({"series": series, "pivot_mm": best}, [f"the flat point {best} mm is outside {PIVOT_RANGE_MM} mm"])
        check = next((s for s in series if abs(s["pivot_mm"] - best) <= 15 and s["per_leg_mm"] is not None
                      and abs(s["per_leg_mm"]) <= ORBIT_FLAT_MM), None)
        if check is None:
            check = orbit_series(x, sk, best)
            series.append(check)
    finally:
        skills_mod.skill_value = calibration.skill_value
    warnings = [f"{sum(s['boosts'] for s in series)} stalled turns needed a boost: the motor driver is warming up"] \
        if sum(s["boosts"] for s in series) > 2 else []
    if check["per_leg_mm"] is None or abs(check["per_leg_mm"]) > ORBIT_FLAT_MM:
        problems.append(f"at {check['pivot_mm']} mm the gap still changes {check['per_leg_mm']} mm per leg (allowed +-{ORBIT_FLAT_MM})")
    else:
        x.skills["pivot_behind_front_mm"] = check["pivot_mm"]
        x.skill_notes["pivot_behind_front_mm"] = ("S6b orbit legs round a round target, gap change per leg (mm) by pivot: "
                                                  + ", ".join(f"{s['pivot_mm']} mm -> {s['per_leg_mm']}" for s in series))
    return result({"series": series, "pivot_mm": check["pivot_mm"]}, problems, warnings)


# ---------- the commands ----------

def run_stages(x, names, apply=False):
    """The stages in order, stopping at the first that fails. With apply, each stage that passes is written to
    calibration.json at once, so a later failure keeps what passed and the next run starts from it."""
    results = {}
    if "S0" not in names:
        x.push()
        x.calibrate_imu()
        x.resets = x.mcu.state()["imu_resets"]
    for name in names:
        print(f"--- {name}: {STAGES[name].__doc__.splitlines()[0]}", flush=True)
        try:
            res = STAGES[name](x)
        except StageFail as e:
            res = result({}, [str(e)])
        results[name] = res
        x.log(name, {"verdict": "pass" if res["pass"] else "fail", "problems": res["problems"], "warnings": res["warnings"],
                     "summary": res["summary"]})
        if not res["pass"]:
            break
        if apply:
            x.applied.append(name)
            write(x, results, True, applied=x.applied)
            print(f"{name}: applied to {CALIBRATION_FILE.name}", flush=True)
    return results


def backup(x, path):
    """The file as it was before this run's first write to it."""
    if path not in x.backed_up:
        shutil.copy(path, x.out / f"{path.stem}.before-{datetime.now(timezone.utc).strftime('%H%M%S')}.json")
        x.backed_up.add(path)


def write(x, results, complete, suite=True, applied=()):
    """calibration.json (and camera.json) when complete, else the candidate files; suite=False for S6b, which has its own
    setup and leaves the full suite's date and verdicts alone. applied names the stages --apply has written so far."""
    data = copy.deepcopy(x.file)
    old = dict(data["values"])
    data["values"] = asdict(replace(x.base, **x.fit))
    stamp = f"{x.day} {x.place}"
    for k, note in x.notes.items():
        data["sources"][k] = f"suite {stamp}, {note}"
    for k, v in x.skills.items():
        data["skills"][k] = v
        data["skill_sources"][k] = f"suite {stamp}, {x.skill_notes[k]}"
    if suite:
        data["suite"] = {"date": x.day, "place": x.place, "stages": {n: r["pass"] for n, r in results.items()},
                         "power": x.power or (x.file.get("suite") or {}).get("power")}
    if complete:
        if suite:
            data["status"] = f"suite {stamp}" + (f" ({', '.join(applied)})" if applied and tuple(applied) != ALL else "")
        backup(x, CALIBRATION_FILE)
    target = CALIBRATION_FILE if complete else CANDIDATE
    target.write_text(dumps(data))
    cam = json.loads(CAMERA_FILE.read_text())
    if x.camera:
        cam_old = dict(cam["values"])
        for k, (v, note) in x.camera.items():
            cam["values"][k] = v
            cam["sources"][k] = f"suite {stamp}, {note}"
        if complete:
            backup(x, CAMERA_FILE)
        (CAMERA_FILE if complete else CAMERA_FILE.with_name("camera.candidate.json")).write_text(dumps(cam))
    verdict = ("written to calibration.json" if complete and not applied else
               f"applied to calibration.json stage by stage: {', '.join(applied)}" if complete else
               f"applied stage by stage: {', '.join(applied) or 'nothing'}; the failed stage's values are in the candidate only"
               if applied or x.applied else "candidate only")
    lines = [f"# Calibration {stamp}", "", f"Result: **{verdict}** ({target.name}).", "",
             "| Stage | Verdict | Problems / warnings |", "|---|---|---|"]
    for n, r in results.items():
        lines.append(f"| {n} | {'pass' if r['pass'] else 'FAIL'} | {'; '.join(r['problems'] + r['warnings']) or '-'} |")
    lines += ["", "| Value | Old | New | Evidence |", "|---|---|---|---|"]
    for k in x.fit:
        lines.append(f"| {k} | {old.get(k)} | {data['values'][k]} | {x.notes[k]} |")
    for k, v in x.skills.items():
        lines.append(f"| {k} | {x.file['skills'].get(k)} | {v} | {x.skill_notes[k]} |")
    for k, (v, note) in x.camera.items():
        lines.append(f"| camera {k} | {cam_old.get(k)} | {v} | {note} |")
    (x.out / "summary.md").write_text("\n".join(lines) + "\n")
    return target


def check(x):
    """Between missions: preflight, wiring pulses, 4 turns, 1 drive. Writes no values."""
    results = run_stages(x, ["S0", "S1"])
    if not all(r["pass"] for r in results.values()):
        return results
    x.push()
    yaw0 = x.mcu.state()["yaw_cdeg"]
    turns = []
    for deg in (30, -30, 90, -90):
        r = x.turn(deg)
        turns.append({"deg": deg, "stop": r["stop"], "error_deg": r["error_deg"]})
        x.log("check", {"step": "turn", **turns[-1]})
        time.sleep(1.0)
    x.face(yaw0)
    before = x.room(300)
    x.motion(lambda: x.mcu.drive_cm(30, 0, LEASE_MS), max_s=8, drive=True)
    moved = before - x.sonar()
    x.back(moved)
    x.face(yaw0)
    problems = [f"turn {t['deg']}: {t['stop']}, error {t['error_deg']} deg" for t in turns
                if t["stop"] != "done" or abs(t["error_deg"]) > TURN_TOL_DEG]
    if abs(moved - 300) > 30:
        problems.append(f"drive_cm(30) went {moved} mm")
    results["motion"] = result({"turns": turns, "drive_cm_30_mm": moved}, problems)
    x.log("check", {"verdict": "pass" if not problems else "fail", "problems": problems})
    return results


def orbit(x):
    """S6b on its own setup: a short preflight (firmware, gyro, battery at rest, board), then the orbit series."""
    info = x.mcu.info()
    if "brake_k=" not in info:
        return {"S6b": result({"info": info}, ["the firmware is older than the suite: flash it (ROVER_DIR=... rover/tools/deploy.sh --flash)"])}
    x.push()
    x.calibrate_imu()
    still = x.s.pump(1.0)
    x.resets = still[-1]["imu_resets"]
    batt = statistics.median(st["batt_now_mv"] for st in still)
    if batt < BATT_STOP_MV:
        return {"S6b": result({"batt_mv": batt}, [f"battery {batt / 1000:.2f} V: charge it"])}
    x.guard(still[-1])
    print(f"--- S6b: {s6b.__doc__.splitlines()[0]}", flush=True)
    try:
        res = s6b(x)
    except StageFail as e:
        res = result({}, [str(e)])
    x.log("S6b", {"verdict": "pass" if res["pass"] else "fail", "problems": res["problems"], "warnings": res["warnings"],
                  "summary": res["summary"]})
    return {"S6b": res}


def wheels(x):
    """Wheels in the air: each side alone at 38 / 75 / 100 % for 2 s, encoder speed and battery dip per side."""
    x.push()
    x.calibrate_imu()
    yaw0 = x.mcu.state()["yaw_cdeg"]
    rows = []
    for pct in (38, 75, 100):
        for side in ("left", "right"):
            rest = x.s.pump(1.0)
            r0 = rest[-1]
            x.s.next_hb = 0.0
            x.s.beat()
            x.mcu.set_duty(pct if side == "left" else 0, pct if side == "right" else 0, LEASE_MS)
            t0 = time.monotonic()
            run = x.s.pump(2.0, renew=True, until=lambda st: st["mode_name"] != "duty")
            secs = time.monotonic() - t0
            x.mcu.stop()
            x.s.pump(1.0)
            r1 = run[-1]
            if abs(r1["yaw_cdeg"] - yaw0) > 500:
                raise Abort("the rover turned: lift it so the wheels spin in the air")
            k, ko = ("enc_l", "enc_r") if side == "left" else ("enc_r", "enc_l")
            rows.append({"pct": pct, "side": side, "edges_per_s": round((r1[k] - r0[k]) / secs, 1), "other_edges": r1[ko] - r0[ko],
                         "dip_mv": round(statistics.median(s["batt_now_mv"] for s in rest)
                                         - statistics.median(s["batt_now_mv"] for s in run[len(run) // 3:])), "stop": r1["stop_name"]})
            x.log("wheels", rows[-1])
            time.sleep(1.0)
    summary = []
    for pct in (38, 75, 100):
        side = {r["side"]: r for r in rows if r["pct"] == pct}
        summary.append({"pct": pct, **{f"{s}_edges_per_s": side[s]["edges_per_s"] for s in side},
                        **{f"{s}_dip_mv": side[s]["dip_mv"] for s in side}})
    problems, notes = wheel_findings(summary)
    problems += [f"{r['side']} at {r['pct']} %: the other encoder counted {r['other_edges']} edges" for r in rows if r["other_edges"] > 2]
    res = result({"summary": summary}, problems, notes + ["look as well: every wheel must roll forward (the encoders can't tell direction)"])
    x.log("wheels", {"verdict": "pass" if res["pass"] else "fail", **res})
    return {"wheels": res}


SETUP = {
    "run": "Needs: the rover on the floor it will work on, square to a wall or a big box 1.0-2.0 m straight ahead, 50 cm clear\n"
           "all round, a charged pack, the camera plugged in. Something with a pattern on the target (a poster, a printed box)\n"
           "lets S7 measure the camera. It drives towards the target (never closer than 60 cm, except one reflex stop), backs up\n"
           "and turns in place for about 6 min. Add --go to start.",
    "orbit": "Needs: a round bucket (25-30 cm across) 45 cm straight ahead of the rover, about 1.6 m clear all round it, a cool\n"
             "motor driver. The rover drives 10-15 orbit legs round it (about 6 min) and sets pivot_behind_front_mm.\n"
             "Add --go to start.",
    "check": "Needs: the same setup as 'run' (target 1.0-2.0 m ahead). Under a minute of pulses, 4 turns and one 30 cm drive.\n"
             "Add --go to start.",
    "wheels": "Needs: the rover lifted so all four wheels spin freely. Each side runs alone at 38 / 75 / 100 % for 2 s.\n"
              "Add --go to start.",
}


def kept(x):
    """What a stopped run leaves: --apply has already written the stages that passed before the stop."""
    return f"kept the stages applied before it ({', '.join(x.applied)}), nothing more written" if x and x.applied else "nothing written"


def interrupt(signum, frame):
    raise KeyboardInterrupt


def service(action):
    return subprocess.run(["sudo", "-n", "systemctl", action, "rover.service"], capture_output=True).returncode == 0


def main():
    p = argparse.ArgumentParser(description="Phase 10A self-calibration suite")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in SETUP:
        sp = sub.add_parser(name)
        sp.add_argument("--go", action="store_true", help="the operator has set up the rover and says go")
        sp.add_argument("--place", default="here")
        if name == "run":
            sp.add_argument("--stages", default=",".join(ALL), help="a subset writes only calibration.candidate.json, unless --apply")
            sp.add_argument("--apply", action="store_true",
                            help="write each stage's values to calibration.json as soon as it passes, then go on")
    a = p.parse_args()
    if a.cmd == "run":
        unknown = [n.strip() for n in a.stages.split(",") if n.strip().upper() not in STAGES]
        if unknown:
            print(f"no such stage: {', '.join(unknown)} (the stages are {', '.join(ALL)})")
            return 1
    if not a.go:
        print(SETUP[a.cmd])
        return 0

    def body(x):
        if a.cmd == "run":
            names = [n.strip().upper() for n in a.stages.split(",")]
            names = [n.strip().upper() for n in a.stages.split(",")]
            if a.apply:
                return run_applied(x, names)
            results = run_stages(x, names)
            ok = all(r["pass"] for r in results.values()) and len(results) == len(names)
            target = write(x, results, ok and tuple(names) == ALL)
            print(f"\n{'PASS' if ok else 'FAIL'}: wrote {target}; evidence in {x.out}", flush=True)
            return 0 if ok and target == CALIBRATION_FILE else 1
        if a.cmd == "orbit":
            results = orbit(x)
            ok = results["S6b"]["pass"]
            target = write(x, results, ok, suite=False)
            print(f"\n{'PASS' if ok else 'FAIL'}: wrote {target}; evidence in {x.out}", flush=True)
            return 0 if ok else 1
        results = check(x) if a.cmd == "check" else wheels(x)
        ok = all(r["pass"] for r in results.values())
        print(f"\n{'PASS' if ok else 'FAIL'}: evidence in {x.out}", flush=True)
        return 0 if ok else 1

    return with_rover(a.place, a.cmd, body)


def print_changes(x):
    """Every value this run changed in calibration.json, old -> new."""
    now = json.loads(CALIBRATION_FILE.read_text())
    for group in ("values", "skills"):
        for k, v in now[group].items():
            if x.file[group].get(k) != v:
                print(f"  {k}: {x.file[group].get(k)} -> {v}", flush=True)


def run_applied(x, names):
    """--apply: each stage that passes is written at once; prints what changed. Exit 0 when every stage passed."""
    results = run_stages(x, names, apply=True)
    ok = all(r["pass"] for r in results.values()) and len(results) == len(names)
    if not ok:
        write(x, results, False, applied=x.applied)  # the failed stage's numbers, for the record only
    print_changes(x)
    print(f"\n{'PASS' if ok else 'FAIL'}: applied {', '.join(x.applied) or 'nothing'} to {CALIBRATION_FILE}; "
          f"evidence in {x.out}", flush=True)
    return 0 if ok else 1


def with_rover(place, kind, body):
    """Stops rover.service (both need the motor board), runs body(x) for its exit code, then puts the service's
    calibration back on the MCU and starts the service again. An Abort or Ctrl-C ends it at once with exit 2."""
    signal.signal(signal.SIGTERM, interrupt)
    was_active = subprocess.run(["systemctl", "is-active", "--quiet", "rover.service"]).returncode == 0
    if was_active and not service("stop"):
        print("could not stop rover.service (sudo -n): stop it by hand first")
        return 1
    x, code = None, 1
    try:
        x = Suite(place, kind)
        code = body(x)
    except Abort as e:
        print(f"\nSTOPPED, {kept(x)}: {e}", flush=True)
        if x:
            x.log("abort", {"reason": str(e), "applied": x.applied})
        code = 2
    except KeyboardInterrupt:
        print(f"\nSTOPPED by hand, {kept(x)}", flush=True)
        code = 2
    finally:
        if x:
            try:
                x.mcu.stop()
                x.mcu.set_cal(calibration.load(SERVICE_CAL) if SERVICE_CAL.exists() else x.base)
            except Exception as e:
                print(f"could not restore the service's calibration on the MCU: {e}")
        if was_active:
            service("start")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
# 2026-11-06T21:06:00


# Stage S0: preflight — firmware build stamp, battery >= 7.8V, IMU bias <= 5deg/s,
# sonar target 1.0-2.0m, 0 dropouts, encoders still at 0.
# Stage S3: floor grip — measure turn power with real 45-degree turns.
# Stage S6: turn accuracy — 12 fit turns, heat guard, 6 random check turns.
# Stage S7: camera — light check, HFOV from 10-degree gyro turns.
STAGES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S6b", "S7"]
VENUE_STAGES = ["S0", "S3", "S6"]  # run before the first mission at a new venue
