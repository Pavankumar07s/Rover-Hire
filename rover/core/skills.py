"""Motion skills. A motion keeps its MCU lease only while the gate reports that every lease holds."""

import hashlib
import math
import time

from .calibration import load, skill_value

LEASE_MS = 1500
RENEW_S = 0.5
POLL_S = 0.05
SETTLE_S = 2.0
STILL_CDPS = 200
APPROACH_MAX_CM = 50  # D2: one paid move is at most 50 cm
STOP_CM_MIN, STOP_CM_MAX = 45, 60  # A live run: at 30 cm the box filled the frame (3 refusals, 5 back-offs); photos land at 48-56 cm
APPROACH_MARGIN_CM = 10  # the timed cap must not end the drive before the sonar stop (short drives undershoot)
APPROACH_BLIND_CM = 25  # no echo: soft, low or slanted objects are invisible to the sonar (P3), so drive less and look again
APPROACH_PAST_MM = 200  # a reading this far beyond the dead-reckoned gap is the room behind a slanted parcel face
APPROACH_MIN_CM = 5
ORBIT_STEP_DEG = 36  # each leg moves this far around the target
ORBIT_OUT_DEG = 90 - ORBIT_STEP_DEG // 2  # 72; the turn in is about 108 back, set from the IMU
ORBIT_DEFAULT_GAP_MM = STOP_CM_MIN * 10  # approach's closest stop, used when the sonar sees nothing and no gap is remembered
ORBIT_GAP_MM = (150, 700)  # a sonar reading in this range is the parcel, not the wall behind it
SONAR_FRESH_S = 0.2  # three fresh 60 ms pings for the MCU's median-of-3 sonar
SCAN_SKIP_FRAMES = 2  # the newest frame after a stop may have been exposed while turning
EXPLORE_CLEAR_CM = 30  # explore stops this far from whatever the sonar hears ahead
EXPLORE_MIN_CM = 10  # less room than this ahead: the way is blocked
MIN_TURN_DEG = 3
BACK_OFF_CM = 20  # the sonar faces forward and the reflex guards only forward drives, so reversing stays short


def brake_mm() -> int:
    """Where the MCU reflex brakes at cruise speed."""
    cal = load()
    return cal.reflex_base_mm + cal.cruise_mm_s * 4 // 10


def sonar_lead_mm(travel_mm):
    """How far drive_until coasts past its sonar distance: grows with travel until cruise speed (P2 fit)."""
    top = skill_value("sonar_lead_max_mm")
    if travel_mm is None:
        return top
    return round(min(top, skill_value("sonar_lead_base_mm") + skill_value("sonar_lead_per_mm") * travel_mm))


class SkillError(RuntimeError):
    pass


def orbit_gap(sonar_mm: int, remembered_mm: int | None) -> tuple[int, str]:
    """The gap to the parcel an orbit leg plans its circle on: the sonar's, else the last one the mission measured, else
    the default. A slanted face echoes the sound away: a live run planned 14 of 19 legs on the 30 cm default."""
    if ORBIT_GAP_MM[0] <= sonar_mm <= ORBIT_GAP_MM[1]:
        return sonar_mm, "sonar"
    if remembered_mm is not None:
        return remembered_mm, "remembered"
    return ORBIT_DEFAULT_GAP_MM, "default"


def bbox_heading_deg(bbox, hfov_deg: float) -> float:
    """Degrees to turn so the box centre is straight ahead (pinhole model, bbox in 0-1000); + is left."""
    x1, _, x2, _ = bbox
    offset = ((x1 + x2) / 2 - 500) / 500
    return -math.degrees(math.atan(offset * math.tan(math.radians(hfov_deg / 2))))


def sweep_offsets_cdeg(views: int, span_deg: int) -> list[int]:
    """Headings of a sweep's views from where it began, far left (+) to far right (-)."""
    return [span_deg * 100 - k * 2 * span_deg * 100 // (views - 1) for k in range(views)]


class Skills:
    def __init__(self, worker, camera, gate, hfov_deg: float):
        self.worker = worker
        self.camera = camera
        self.gate = gate
        self.hfov_deg = hfov_deg

    def _run(self, method, *args, timeout_s=12.0):
        before = self.worker.call("state")
        self.worker.call(method, *args)
        next_renew = time.monotonic() + RENEW_S
        end = time.monotonic() + timeout_s
        stopped_by = None
        st = before
        while time.monotonic() < end:
            st = self.worker.call("state")
            started = st["start_ms"] != before["start_ms"]
            if started and st["mode_name"] in ("brake", "idle"):
                break
            if time.monotonic() >= next_renew:
                ok, reason = self.gate()
                if not ok:
                    self.worker.call("stop")
                    stopped_by = reason
                else:
                    self.worker.call("lease", LEASE_MS)
                next_renew = time.monotonic() + RENEW_S
            time.sleep(POLL_S)
        else:
            self.worker.call("stop")
            stopped_by = "timeout"
        st = self._settle()
        return {
            "cmd": method, "args": list(args), "stop_reason": st["stop_name"], "stopped_by": stopped_by,
            "yaw_change_cdeg": st["yaw_cdeg"] - before["yaw_cdeg"], "dist_mm": st["dist_mm"],
            "sonar_mm": st["sonar_mm"], "batt_min_mv": st["batt_min_mv"],
        }

    def _settle(self):
        """The rover coasts after the brake: report the heading once it is idle and still."""
        end, calm, st = time.monotonic() + SETTLE_S, 0, None
        while time.monotonic() < end:
            st = self.worker.call("state")
            calm = calm + 1 if st["mode_name"] == "idle" and abs(st["rate_cdps"]) < STILL_CDPS else 0
            if calm >= 5:
                break
            time.sleep(POLL_S / 2)
        return st

    def _need_hfov(self):
        if self.hfov_deg <= 0:
            raise SkillError("camera hfov not measured (camera.json)")

    def turn(self, deg: int, correct: bool = True):
        """One turn plus at most one correction: the P1 soak scattered about +-3 deg around a 1 deg short bias."""
        if abs(deg) < MIN_TURN_DEG:
            return {"cmd": "turn_deg", "args": [deg], "skipped": "below minimum turn"}
        first = self._turn_boosted(int(deg))
        error = deg - first["yaw_change_cdeg"] / 100
        if not correct or first["stopped_by"] or first["stop_reason"] != "done" or abs(error) < MIN_TURN_DEG:
            return first
        fix = self._turn_boosted(round(error))
        return {**fix, "args": [deg], "yaw_change_cdeg": first["yaw_change_cdeg"] + fix["yaw_change_cdeg"],
                "correction": {"first_cdeg": first["yaw_change_cdeg"], "fix_deg": round(error)}}

    def _turn_boosted(self, deg: int):
        """A turn that stalls (a damp or grippy floor holds the tyres: 38 of 57 turns in a live run after the floor was
        wiped) is tried again for what is left at each boost power, then the normal calibration goes back."""
        res = self._run("turn_deg", deg, LEASE_MS)
        turned, boosts = res["yaw_change_cdeg"], []
        for pct in skill_value("turn_boost_pct"):
            left = round(deg - turned / 100)
            if res["stop_reason"] != "stall" or res["stopped_by"] or abs(left) < MIN_TURN_DEG:
                break
            self.worker.call("set_cal", load(turn_pct=pct, turn_kick_pct=100))
            try:
                res = self._run("turn_deg", left, LEASE_MS)
            finally:
                self.worker.call("set_cal", load())
            turned += res["yaw_change_cdeg"]
            boosts.append({"turn_pct": pct, "deg": left, "yaw_change_cdeg": res["yaw_change_cdeg"], "stop_reason": res["stop_reason"]})
        return {**res, "args": [deg, LEASE_MS], "yaw_change_cdeg": turned, "boosts": boosts} if boosts else res

    def face_target(self, bbox):
        self._need_hfov()
        return self.turn(self.target_turn_deg(bbox))

    def back_off(self):
        """Straight back, away from a parcel that fills the frame. Only right after the rover drove to where it is, so
        it reverses over ground it has just crossed (mission rule)."""
        return {"skill": "back_off", "steps": [self._run("drive_cm", -BACK_OFF_CM, 0, LEASE_MS)]}

    def target_turn_deg(self, bbox) -> int:
        """The turn face_target would make; below MIN_TURN_DEG it makes none."""
        return round(bbox_heading_deg(bbox, self.hfov_deg))

    def approach(self, bbox, stop_cm, expected_mm: int | None = None):
        """expected_mm is the gap the mission dead-reckoned. Driving forward cannot move the parcel away, so a reading far
        past it, or none, is the room behind a slanted face: plan on the expected gap, blind-capped and with no margin
        (a live run, seq 4: 196 cm 50 cm after a 98 cm reading, and the rover drove 50 cm more, to a few cm off the box)."""
        self._need_hfov()
        stop_cm = max(STOP_CM_MIN, min(STOP_CM_MAX, int(stop_cm)))
        steps = [self.face_target(bbox)]
        if steps[-1].get("stopped_by"):
            return {"skill": "approach", "steps": steps}
        sonar = self.worker.call("state")["sonar_mm"]
        if sonar >= 0 and (expected_mm is None or sonar <= expected_mm + APPROACH_PAST_MM):
            plan, plan_from = sonar, "sonar"
            max_cm = min(APPROACH_MAX_CM, (sonar - stop_cm * 10) // 10 + APPROACH_MARGIN_CM)
        elif expected_mm is not None:
            plan, plan_from = expected_mm, "expected"
            max_cm = min(APPROACH_BLIND_CM, (expected_mm - stop_cm * 10) // 10)
        else:
            plan, plan_from, max_cm = None, "blind", APPROACH_BLIND_CM
        res = {"skill": "approach", "stop_cm": stop_cm, "plan_mm": plan, "plan_from": plan_from, "steps": steps}
        if plan is not None and (plan <= stop_cm * 10 + 20 or max_cm < APPROACH_MIN_CM):
            return {**res, "skipped": f"{plan_from} already {plan} mm"}
        stop_mm = stop_cm * 10 + sonar_lead_mm(plan - stop_cm * 10 if plan is not None else None)
        steps.append(self._run("drive_until", max_cm, stop_mm, LEASE_MS))
        return res

    def orbit_leg(self, direction: str = "left", remembered_gap_mm: int | None = None):
        """Chord of the circle around the target, centred on the rover's pivot: leg = 2 R sin(step / 2).
        left: out to the rover's left, net heading -36 deg; right is the mirror image."""
        sign = 1 if direction == "left" else -1
        sonar = self.worker.call("state")["sonar_mm"]
        gap, gap_from = orbit_gap(sonar, remembered_gap_mm)
        radius_mm = gap + skill_value("target_half_depth_mm") + skill_value("pivot_behind_front_mm")
        leg_cm = min(APPROACH_MAX_CM, round(2 * radius_mm * math.sin(math.radians(ORBIT_STEP_DEG / 2)) / 10))
        yaw0 = self.worker.call("state")["yaw_cdeg"]
        # No correction on the way out: the turn back is computed from the IMU and absorbs this turn's error (P6).
        steps = [self.turn(sign * ORBIT_OUT_DEG, correct=False)]
        blocked, path_mm, need_mm = False, None, leg_cm * 10 + brake_mm()
        if not steps[-1].get("stopped_by"):
            # The sonar now points along the leg: drive only if the leg and the reflex's brake distance are clear
            # (a live run, seq 13 drove 32 cm at a wall 27.5 cm ahead). No echo still drives: slanted walls are invisible.
            time.sleep(SONAR_FRESH_S)
            path_mm = self.worker.call("state")["sonar_mm"]
            if 0 <= path_mm < need_mm:
                blocked = True
                so_far = (self.worker.call("state")["yaw_cdeg"] - yaw0) / 100
                steps.append(self.turn(round(-so_far)))  # face the parcel again; 0G picks the way round
            else:
                steps.append(self._run("drive_cm", leg_cm, 0, LEASE_MS))
        if not blocked and not steps[-1].get("stopped_by"):
            # Turn in by whatever makes the net heading change exactly -sign*ORBIT_STEP_DEG, absorbing earlier error.
            so_far = (self.worker.call("state")["yaw_cdeg"] - yaw0) / 100
            steps.append(self.turn(round(-sign * ORBIT_STEP_DEG - so_far)))
        net = self.worker.call("state")["yaw_cdeg"] - yaw0
        return {"skill": "orbit_leg", "direction": direction, "gap_mm": gap, "gap_from": gap_from, "radius_mm": radius_mm, "leg_cm": leg_cm,
                "path_mm": path_mm, "need_mm": need_mm, "blocked": blocked, "net_cdeg": net, "steps": steps}

    def _still_frame(self):
        """A camera frame exposed after the rover came to rest."""
        seq0 = self.camera.latest()[2]
        end = time.monotonic() + SETTLE_S
        while time.monotonic() < end:
            frame, _, seq = self.camera.latest()
            if seq >= seq0 + SCAN_SKIP_FRAMES:
                return frame
            time.sleep(POLL_S)
        raise SkillError("no camera frame after the turn")

    def _turn_to(self, yaw_cdeg: int):
        """Turn the short way round to an IMU heading."""
        now = self.worker.call("state")["yaw_cdeg"]
        return self.turn(round(((yaw_cdeg - now) / 100 + 180) % 360 - 180))

    def scan(self, views: int):
        """Look all the way round in place, one still frame per view; each heading is set from where the scan began,
        so turn errors do not add up."""
        yaw0 = self.worker.call("state")["yaw_cdeg"]
        shots, steps = [], []
        for k in range(views):
            if k:
                steps.append(self._turn_to(yaw0 + k * 36000 // views))
                if steps[-1].get("stopped_by"):
                    break
            st = self.worker.call("state")
            shots.append({"frame": self._still_frame(), "yaw_cdeg": st["yaw_cdeg"], "sonar_mm": st["sonar_mm"]})
        return {"skill": "scan", "views": shots, "steps": steps}

    def sweep(self, views: int, span_deg: int):
        """A quick look from span_deg left to span_deg right of where the rover faces, one still frame per view, photo 1
        at the far left; headings are set from where it began, like a scan."""
        yaw0 = self.worker.call("state")["yaw_cdeg"]
        shots, steps = [], []
        for off in sweep_offsets_cdeg(views, span_deg):
            steps.append(self._turn_to(yaw0 + off))
            if steps[-1].get("stopped_by"):
                break
            st = self.worker.call("state")
            shots.append({"frame": self._still_frame(), "yaw_cdeg": st["yaw_cdeg"], "sonar_mm": st["sonar_mm"]})
        return {"skill": "scan", "sweep": True, "views": shots, "steps": steps}

    def face_view(self, yaw_cdeg: int):
        return {"skill": "face_view", "steps": [self._turn_to(yaw_cdeg)]}

    def explore(self, yaw_cdeg: int):
        """Face a scan view and drive at most one move that way, stopping short of whatever the sonar hears."""
        steps = [self._turn_to(yaw_cdeg)]
        if steps[-1].get("stopped_by"):
            return {"skill": "explore", "blocked": False, "steps": steps}
        time.sleep(SONAR_FRESH_S)
        sonar = self.worker.call("state")["sonar_mm"]
        clear_mm = EXPLORE_CLEAR_CM * 10
        if 0 <= sonar < clear_mm + EXPLORE_MIN_CM * 10:
            return {"skill": "explore", "blocked": True, "sonar_mm": sonar, "steps": steps}
        max_cm = APPROACH_BLIND_CM if sonar < 0 else min(APPROACH_MAX_CM, (sonar - clear_mm) // 10)
        stop_mm = clear_mm + sonar_lead_mm(sonar - clear_mm if sonar >= 0 else None)
        steps.append(self._run("drive_until", max_cm, stop_mm, LEASE_MS))
        return {"skill": "explore", "blocked": False, "sonar_mm": sonar, "steps": steps}

    def photo(self):
        shot = self.camera.jpeg_full()
        if shot is None:
            raise SkillError("no fresh camera frame")
        jpeg, at, seq = shot
        return {"skill": "photo", "jpeg": jpeg, "sha256": hashlib.sha256(jpeg).hexdigest(), "frame_seq": seq}

    def stop(self):
        self.worker.call("stop")
        return {"skill": "stop"}
# 2026-11-06T02:48:00
# 2026-11-06T16:18:00
# 2026-11-06T22:14:44
