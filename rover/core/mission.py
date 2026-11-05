"""The mission loop (HANDOFF §5, plan P6). Each checkpoint: frame → 0G decision → TEE proof → money for a move →
skill under MCU leases renewed only while all three leases hold → hash-chained record → zg-log.
Any failure holds position with a face and asks 0G again; a decision is never reused or invented."""

import hashlib
import json
import logging
import threading
import time
from pathlib import Path

from rover.zg.brain import FRAME_MAX_AGE_S, BrainError, new_nonce, now_ms, parcel_number, same_number, scan_json, sensors_json
from rover.zg.checkpoint import checkpoint_fields
from rover.zg.proof import ProofError
from rover.zg.prompt import NUMBER_PROMPT_VERSION, SCAN_PICKS, SCAN_VIEWS, SKILLS, SWEEP_SPAN_DEG, SWEEP_VIEWS
from rover.zg.records import Chain

from .camera import crop_box
from .mcu import McuError
from .skills import MIN_TURN_DEG, ORBIT_GAP_MM, SkillError

MOVING = ("approach", "orbit_leg", "turn", "back_off", "scan", "face_view", "explore")
BACKOFF_AFTER, BACKOFF_S = 3, 5.0
LAST_ACTIONS = 3
IMU_OK = 2  # MCU state flags bit: IMU present, calibrated and reading
HOLD_S = 2.0  # after a refused skill or a failed IMU recalibration
PHOTO_SIDE_CDEG = 1800  # half an orbit leg (36°): the least heading gap between photos (by walls and obstacles)
PHOTO_GAP_CDEG = 3000  # about one orbit leg: any new viewpoint counts, corners too (a live run: a 96° lap spacing
                       # refused corner views 34-71° round); a leg turns 33-36°, so 36° refused 30 views in five runs
ORBIT_STEP_CDEG = 3600  # what one orbit leg turns
EXPLORE_FREE_MM = 1000  # a view is worth exploring toward with this much room ahead, or no echo
MAX_DRIVE_MM = 1000  # no single drive goes this far (D2 caps a paid move at 50 cm)
BATT_SENSE_LOST_V = 4.0  # the firmware holds a reading this low out for 2 s; still there, it is the switch or the sense wire
APPROACH_ECHO_MM = 1000  # after a photo the parcel is 27-62 cm away (P6 sonar); farther or no echo: the sonar is not on it
DEFAULT_STOP_CM = 45
IMU_LSB_PER_DPS = 65.5  # firmware gyro range +-500 deg/s
IMU_BIAS_MAX_CDPS = 500  # a still MPU-6050 reads ~1 deg/s (0.97 measured); 53 deg/s was the rover turned by hand
IMU_DRIFT_MAX_CDPS = 50  # heading drift after a good calibration, standing still: 0.002 deg/s
IMU_TRIES = 3
EVIDENCE = Path.home() / "0xbs-rover" / "evidence" / "P6"

log = logging.getLogger("rover.mission")


class ImuNotSteady(RuntimeError):
    """Calibration did not leave a steady heading: the rover is being moved, or the IMU is faulty."""


def steady_imu_cal(worker, tries: int = IMU_TRIES, settle_s: float = 1.0) -> dict:
    """imu_cal averages the gyro for ~1.2 s and keeps whatever it reads as the still bias, so a rover carried or turned
    by hand meanwhile spins its heading afterwards (a live run: 53 deg/s, photos of one side paid as new sides).
    Calibrate, then check the heading holds while standing still; try again a few times. Integers only (cdeg/s): the
    result goes into records, which hold no floats (D10).
    A loose gyro supply wire (42 resets, 61 failed reads) fails a calibration outright, or resets the chip during
    the check, which then reads zeros and passes as perfectly still: both count as a failed try."""
    last, fault = None, None
    for _ in range(tries):
        try:
            bias = worker.call("imu_cal", timeout=10)
        except McuError as e:
            fault = f"calibration failed ({e})"
            time.sleep(settle_s)
            continue
        st0, t0 = worker.call("state"), time.monotonic()
        time.sleep(settle_s)
        st1 = worker.call("state")
        last = {"bias_x100": bias, "bias_cdps": round(bias / IMU_LSB_PER_DPS),
                "drift_cdps": round((st1["yaw_cdeg"] - st0["yaw_cdeg"]) / max(time.monotonic() - t0, 1e-3))}
        resets, misreads = st1["imu_resets"] - st0["imu_resets"], st1["imu_bus_errors"] - st0["imu_bus_errors"]
        if resets or misreads or not st1["flags"] & IMU_OK:
            fault = f"the gyro reset {resets} times and failed {misreads} reads while standing still"
            continue
        if abs(last["bias_cdps"]) <= IMU_BIAS_MAX_CDPS and abs(last["drift_cdps"]) <= IMU_DRIFT_MAX_CDPS:
            return last
        fault = None
    if fault:
        raise ImuNotSteady(f"the IMU is faulty: {fault} on the last of {tries} tries; check the gyro's power and I2C wires")
    raise ImuNotSteady(f"the IMU is not steady after {tries} calibrations (bias {last['bias_cdps'] / 100:.2f} deg/s, drift "
                       f"{last['drift_cdps'] / 100:.2f} deg/s); keep the rover still on the floor and try again")


def attempted_skill(raw_response: str) -> str | None:
    """The skill a refused answer asked for, or None if it did not parse."""
    try:
        skill = json.loads(raw_response).get("skill")
    except (ValueError, AttributeError):
        return None
    return skill if isinstance(skill, str) else None


def battery_stop(executed: dict) -> bool:
    """The MCU refused the move for a low battery, or halted mid-drive for one (a live run: 0.0 V, 40 refusals)."""
    steps = (executed.get("result") or {}).get("steps", [])
    return "refused: low_battery" in (executed.get("error") or "") or any(s.get("stop_reason") == "battery" for s in steps)


def sweep_next(scanned: bool, orbited: bool, sweep_missed: bool) -> bool:
    """A scan asked for while going round is a quick look either side; the first scan of a mission, and the one after
    a quick look that found nothing, go all the way round."""
    return scanned and orbited and not sweep_missed


def approach_expected(gap_mm: int | None, sonar_mm: int) -> int | None:
    """The gap an approach checks its sonar against: the dead-reckoned one, else the reading 0G decided on. The face
    turn can swing the sonar off the box onto the wall behind (a live run, seq 2: 0G saw 123 cm, the drive planned on
    257 cm and needed a back-off)."""
    return gap_mm if gap_mm is not None else (sonar_mm if sonar_mm >= 0 else None)


def gap_after(executed: dict, gap: int | None) -> int | None:
    """The rover-to-parcel gap after a move, remembered for an orbit leg whose sonar misses the box. Approach, turn and
    orbit_leg end facing the parcel, so their last sonar reading is the gap when it is in range; an orbit leg keeps the
    gap by design when it is not; an approach takes what it drove off the gap it planned on; a back-off adds what it
    reversed; anything else leaves the rover somewhere else."""
    result = executed.get("result")
    if result is None:
        return gap if executed.get("moved") is False else None
    last = (result.get("steps") or [result])[-1]
    seen = last.get("sonar_mm", -1)
    skill = executed["skill"]
    if skill in ("approach", "turn", "orbit_leg"):
        if ORBIT_GAP_MM[0] <= seen <= ORBIT_GAP_MM[1]:
            return seen
        if skill == "orbit_leg" and gap is None and result.get("gap_from") == "sonar":
            return result["gap_mm"]  # measured at the leg's start; the leg keeps it
        if skill == "approach":
            if result.get("plan_mm") is None:
                return None
            driven = sum(s.get("dist_mm", 0) for s in result.get("steps", []) if s.get("cmd") == "drive_until")
            return max(0, result["plan_mm"] - driven) if 0 <= driven <= MAX_DRIVE_MM else None
        return gap
    if skill == "back_off":
        reversed_mm = abs(last.get("dist_mm", 0))
        if reversed_mm > MAX_DRIVE_MM:
            return None  # an impossible distance (a live run, seq 10: 2040109446 mm) says nothing about where the rover is
        return gap + reversed_mm if gap is not None else None
    return None


def explore_views(view_sonar_mm: list[int]) -> list[int]:
    """Mission rule (P6): explore only where there is room; with none, only the most open view (0G chose walls)."""
    free = [n for n, mm in enumerate(view_sonar_mm, 1) if mm < 0 or mm >= EXPLORE_FREE_MM]
    return free or [max(range(len(view_sonar_mm)), key=lambda i: view_sonar_mm[i]) + 1]


class Mission:
    def __init__(self, rover, info: dict):
        self.rover = rover
        self.info = info  # episode_id, quote_id, mission, photos_wanted
        self.chain = Chain(info["episode_id"])
        self.stopping = threading.Event()
        self.fault = None  # test switch, only settable in test mode
        self.checkpoints = 0
        self.moves = 0
        self.safe_stops: dict[str, int] = {}
        self.last_actions: list[str] = []
        self.last_orbit = "left"  # used when 0G names no direction: keep going the same way around
        self.orbited = False
        self.photo_yaws: list[int] = []
        self.sheet = None  # the last scan's views, until 0G picks one: {"jpeg", "at", "yaws", "sonar"}
        self.imu_recals: list[dict] = []
        self.recal_note = None  # goes into the next record
        self.imu_suspect = False  # the last calibration did not hold: calibrate again before moving
        self.scanned = False  # a full 360 scan has been done this mission
        self.sweep_missed = False  # the last quick look either side did not find the parcel: the next scan is a full one
        self.refused: list[str] = []  # skills 0G was refused since the rover last moved
        self.end_reason = None  # why the rover ended the mission itself
        self.wheel_mm = 0
        self.gap_mm = None  # the last known rover-to-parcel gap, for orbit legs whose sonar misses the box
        self.yaw0 = 0
        self.last = None
        self.thread = threading.Thread(target=self._run, name="mission", daemon=True)

    def start(self):
        self.thread.start()
        return self

    def stop(self, timeout_s: float = 30.0) -> None:
        """Lets the checkpoint in progress finish and record itself."""
        self.stopping.set()
        self.rover.worker.submit("stop")
        self.thread.join(timeout=timeout_s)

    def status(self) -> dict:
        return {"checkpoints": self.checkpoints, "moves": self.moves, "photos_taken": len(self.rover.photos),
                "safe_stops": self.safe_stops, "imu_recals": len(self.imu_recals), "last": self.last,
                "running": self.thread.is_alive(), "end_reason": self.end_reason}

    def _recalibrate(self, st: dict) -> bool:
        """The IMU chip reset itself (a supply dip) and lost its calibration, so the MCU refuses every turn
        (a live run: 20 paid moves refused). The rover stands still between checkpoints: recalibrate, and keep the
        mission's headings continuous, since imu_cal sets the yaw to 0."""
        rel = st["yaw_cdeg"] - self.yaw0
        try:
            imu = steady_imu_cal(self.rover.worker)
            self.yaw0 = self.rover.worker.call("state")["yaw_cdeg"] - rel
        except Exception as e:
            self.imu_suspect = True  # the MCU may now hold a bad bias it counts as calibrated
            log.error("IMU recalibration failed: %s", e)
            return False
        self.imu_suspect = False
        self.sheet = None  # its headings were measured before the reset
        self.recal_note = {"yaw_cdeg": rel, **imu, "imu_resets": st["imu_resets"]}
        self.imu_recals.append(self.recal_note)
        log.warning("IMU recalibrated mid-mission: %s", self.recal_note)
        return True

    def _face(self, name: str) -> None:
        self.rover.worker.submit("face", name)

    def _wait(self, seconds: float) -> None:
        self.stopping.wait(seconds)

    def _allowed(self, yaw_cdeg: int, sonar_mm: int) -> list[str]:
        """Mission rules, not decisions (P6). No second photo from the same side: the rover faces the parcel for a
        photo, so its heading names the side (a live run: orbit right then left, photo 3 repeated photo 2).
        Once a photo is taken, no approach right after an orbit, which keeps the photo distance by design, and none
        unless the sonar hears something within a metre: with the parcel corner-on the sonar hears the wall behind it
        and the drive runs blind into or past it (two live runs). Before the first photo an orbit goes round
        an obstacle at any distance, so approach stays (a live run: four orbits at ~1 m after a reflex stop).
        The first move is a full scan: the mission can start anywhere, facing away, with decoys, and 0G took a black
        wall marker for the parcel from the first frame (a live run: approached it, then a paid photo of the wall),
        while a scan must read the parcel's number in a view before the rover turns to it."""
        if not self.scanned:
            return [s for s in SKILLS if s in ("scan", "stop")]
        done = [a for a in self.last_actions if not a.startswith("rejected")]  # a rejection note is not a move
        # A skill refused twice since the rover last moved is off the list until it moves: told why, 0G still asked for
        # the same "turn" eight times in a row (a live run, seq 22-29).
        banned = {s for s in self.refused if self.refused.count(s) >= 2}
        # back_off reverses blind (the sonar faces forward), so only straight after driving in: over ground just crossed.
        # A turn in place since is fine (a live run, photo 2: orbit_leg, turn, then a box cut off on three sides).
        moved = [a for a in done if not a.startswith("turn")]
        if not (moved and moved[-1].split(":")[0] in ("approach", "orbit_leg") and ":refused" not in moved[-1]):
            banned.add("back_off")
        # After backing off, no approach until a photo or an orbit leg: 0G drove back in to 30 cm and backed off again
        # four times (a live run, seq 6-18), the mission's 30 cm and a box that fills the frame there pulling both ways.
        backed = max((i for i, a in enumerate(done) if a.startswith("back_off")), default=-1)
        if backed >= 0 and not any(a == "photo" or a.startswith("orbit_leg") for a in done[backed + 1:]):
            banned.add("approach")
        if done and done[-1].startswith("approach") and ":skipped" in done[-1]:
            banned.add("approach")  # it found the parcel already close; asking again only pays for the same turn
        if self._photo_refusal(yaw_cdeg):
            banned.add("photo")
        if self.photo_yaws and ((done and done[-1].startswith("orbit_leg")) or not 0 <= sonar_mm <= APPROACH_ECHO_MM):
            banned.add("approach")
        return [s for s in SKILLS if s not in banned]

    def _photo_gap_cdeg(self) -> int:
        """The heading gap between photos: about one orbit leg in the open. Half a leg bunched photos (a live run: 90°, 51°,
        then a second lap); spreading them round a lap refused good corner views (a live run). Blocked both ways round,
        only part of the circle is reachable (a parcel by a wall), so half a leg."""
        blocked = {a.split(":")[1] for a in self.last_actions if a.startswith("orbit_leg:") and a.endswith(":blocked")}
        if {"left", "right"} <= blocked:
            return PHOTO_SIDE_CDEG
        gap = PHOTO_GAP_CDEG
        # Never more than the photos left can still get: half the largest arc between photos, less half a leg
        # (a live run: photos 113°, 75°, 76° and 96° apart left no 57° side for the fifth; it circled until time ran out).
        if len(self.photo_yaws) >= 2:
            ys = sorted(y % 36000 for y in self.photo_yaws)
            largest = max([b - a for a, b in zip(ys, ys[1:])] + [ys[0] + 36000 - ys[-1]])
            gap = min(gap, max(PHOTO_SIDE_CDEG, largest // 2 - ORBIT_STEP_CDEG // 2))
        return gap

    def _photo_refusal(self, yaw_cdeg: int) -> str | None:
        """Why a photo is not allowed now, told to 0G, or None. Besides the heading, a new side needs a finished
        orbit_leg since the last photo: with a bad IMU calibration the heading drifted while the rover stood still and
        four photos of one side passed as new sides (a live run)."""
        if not self.photo_yaws:
            return None
        if n := self._same_side(yaw_cdeg):
            gap, near = self._photo_gap_cdeg(), self._heading_gap(yaw_cdeg, self.photo_yaws[n - 1])
            legs = -(-(gap - near) // ORBIT_STEP_CDEG)
            return (f"photo {n} was taken {near // 100} deg round from here and photos go {gap // 100} deg apart; "
                    f"orbit_leg on, about {legs} more")
        done = [a for a in self.last_actions if not a.startswith("rejected")]
        since = done[max((i for i, a in enumerate(done) if a == "photo"), default=-1) + 1:]
        if not any(a.startswith("orbit_leg") and ":blocked" not in a and ":refused" not in a for a in since):
            return f"no orbit_leg finished since photo {len(self.photo_yaws)}; orbit_leg to a new side first"
        return None

    def _same_side(self, yaw_cdeg: int) -> int | None:
        """The photo already taken from this side, if any: the rover faces the parcel for a photo, so its heading
        names the side."""
        gap = self._photo_gap_cdeg()
        for n, y in enumerate(self.photo_yaws, 1):
            if self._heading_gap(yaw_cdeg, y) < gap:
                return n
        return None

    @staticmethod
    def _heading_gap(a_cdeg: int, b_cdeg: int) -> int:
        d = (a_cdeg - b_cdeg) % 36000
        return min(d, 36000 - d)

    def _orbit_direction(self, requested: str | None) -> tuple[str, str]:
        """0G decides to orbit; the way round is an execution detail, like a turn's angle. The first leg goes where 0G
        says; after that the rover keeps going round the same way, so every leg reaches a new side, and reverses after
        a blocked leg. 0G's own pick went back and forth between two photographed sides (a live run), and refusing its
        pick deadlocked (a live run)."""
        if not self.orbited:
            return requested or "left", "0G (first leg)"
        legs = [a for a in self.last_actions if a.startswith("orbit_leg")]
        if legs and legs[-1].endswith(":blocked"):
            return ("right" if self.last_orbit == "left" else "left"), "rover: reversed after a blocked leg"
        return self.last_orbit, "rover: keep going round the same way"

    @staticmethod
    def _action(executed: dict) -> str:
        """last_actions entry for 0G: skill, orbit side, ':blocked' when the sonar reflex stopped it or an orbit leg's
        path was not clear, ':no_progress' when an approach drove but the sonar did not get closer (no encoders:
        wheels can strain in place), ':skipped' when an approach found the parcel already close, ':stalled' when a turn
        never got going, and ':refused' when the MCU refused it before anything moved."""
        result = executed.get("result") or {}
        steps = result.get("steps", [])
        parts = [executed["skill"]] + ([result["direction"]] if result.get("direction") else []) + (["sweep"] if result.get("sweep") else [])
        if executed.get("moved") is False:
            parts.append("refused")
        if result.get("blocked") or any(s.get("stop_reason") == "reflex" for s in steps):
            parts.append("blocked")
        if any(s.get("stop_reason") == "stall" for s in steps):
            parts.append("stalled")
        if result.get("skipped") and executed["skill"] == "approach":
            parts.append("skipped")
        for before, step in zip(steps, steps[1:]):
            if step.get("cmd") == "drive_until" and step.get("dist_mm", 0) >= 100 and before.get("sonar_mm", -1) >= 0 \
                    and step.get("sonar_mm", -1) >= 0 and before["sonar_mm"] - step["sonar_mm"] < 0.4 * step["dist_mm"]:
                parts.append("no_progress")
        return ":".join(parts)

    def _sensors(self, st: dict, allowed: list[str]):
        yaw = round((st["yaw_cdeg"] - self.yaw0) / 100)
        last_orbit = self.last_orbit if self.orbited else None
        # Why photo is missing from allowed_skills: without it 0G kept asking for it and answered stop (a live run).
        why = self._photo_refusal(st["yaw_cdeg"] - self.yaw0)
        # The other way round too: after a photo, say when a side is new, so 0G takes it there instead of stopping or
        # orbiting past it (a live run, seq 33-38: a new side lost to timeouts and a "stop", then refused one leg on).
        extra = {"photo_refused": why} if why else \
            {"new_side": f"a new side for photo {len(self.photo_yaws) + 1}"} if self.photo_yaws else {}
        return lambda nonce: sensors_json(nonce, st["sonar_mm"], self.wheel_mm // 10, yaw, st["batt_mv"], len(self.rover.photos),
                                          self.last_actions[-LAST_ACTIONS:], mission=self.info["mission"], allowed=allowed,
                                          last_orbit=last_orbit, **extra)

    def _run(self) -> None:
        leases = self.rover.leases
        fails = 0
        try:
            self.yaw0 = self.rover.worker.call("state")["yaw_cdeg"]
        except Exception as e:
            log.error("mission cannot read the MCU: %s", e)
            return
        while not self.stopping.is_set():
            if len(self.rover.photos) >= self.info["photos_wanted"] > 0:
                # Nothing left to do but wait for the buyer to end it: asking 0G again drove a prepaid orbit leg until the
                # end cut it mid-turn (three live runs).
                self._face("DONE")
                self.stopping.wait()
                break
            st = self.rover.worker.call("state")
            if not st["flags"] & IMU_OK or self.imu_suspect:
                if not self._recalibrate(st):
                    self._face("STOP")
                    self._wait(HOLD_S)
                    continue
                st = self.rover.worker.call("state")
            self._face("thinking")
            if self.sheet and time.monotonic() - self.sheet["at"] > FRAME_MAX_AGE_S:
                self.sheet = None  # too old to decide on; 0G will ask for a new scan
            sheet = self.sheet
            if sheet:
                jpeg, full, at, seq = sheet["jpeg"], None, sheet["at"], None
            else:
                shot = self.rover.camera.jpeg_pair()
                if shot is None:
                    log.warning("no fresh camera frame; waiting")
                    self._wait(1.0)
                    continue
                jpeg, full, at, seq = shot
            age = time.monotonic() - at
            scan = None
            if sheet:
                views = len(sheet["yaws"])
                allowed, orbit = (["face_view"] if views == SWEEP_VIEWS else list(SCAN_PICKS)), None
                scan = {"number": parcel_number(self.info["mission"]), "views": views,
                        "explore_views": explore_views(sheet["sonar"]) if views == SCAN_VIEWS else []}
                sensors = lambda nonce: scan_json(nonce, len(self.rover.photos), sheet["sonar"], scan["explore_views"],
                                                  self.info["mission"])
            else:
                allowed, orbit = self._allowed(st["yaw_cdeg"] - self.yaw0, st["sonar_mm"]), None
                sensors = self._sensors(st, allowed)
            fields, _ = checkpoint_fields(self.rover.brain, self.rover.prover, jpeg, now_ms() - round(age * 1000), age,
                                          sensors, fault=self.fault, allowed=allowed, orbit=orbit, scan=scan,
                                          number=parcel_number(self.info["mission"]))
            fields["quote_id"] = self.info["quote_id"]
            if self.recal_note:
                fields["imu_recal"], self.recal_note = self.recal_note, None
            with leases.lock:
                leases.brain, leases.proof = fields["leases"]["brain"], fields["leases"]["proof"]
            d = fields["decision"]
            if d and d["skill"] == "turn" and self.rover.skills.hfov_deg > 0 \
                    and abs(self.rover.skills.target_turn_deg(d["target"])) < MIN_TURN_DEG:
                # A turn too small to make would still use a paid move (a live run: four 0 deg turns in a row while 0G
                # called the parcel "slightly off-center"): a rule rejection instead, saying what is allowed instead.
                then = "take the photo" if "photo" in allowed else "orbit_leg on"
                fields["decision"], fields["safe_stop"] = None, {"reason": "0G?", "detail": f"turn: parcel already centred; {then}"}
            if d and d["skill"] == "photo" and not fields["safe_stop"]:
                check = fields["number_check"] = self._number_check(full, d["target"])
                if not check["ok"]:
                    shows = f"#{check['number']}" if check["number"] else "no number"
                    why = "crop check failed" if "error" in check else f"crop shows {shows}, not #{parcel_number(self.info['mission'])}"
                    fields["decision"], fields["safe_stop"] = None, {"reason": "0G?", "detail": f"photo: {why}"}
            if fields["safe_stop"]:
                if sheet and len(sheet["yaws"]) == SWEEP_VIEWS:
                    self.sheet, self.sweep_missed = None, True  # the quick look did not find it: 0G's next scan is a full one
                if fields["raw_response"] and not fields["decision"]:
                    # The model answered but broke a rule. At temperature 0 the same input gives the same answer,
                    # so tell it why in last_actions; it still chooses, the rover only reports the fact.
                    self.last_actions.append(f"rejected: {fields['safe_stop']['detail']}"[:60])
                    if skill := attempted_skill(fields["raw_response"]):
                        self.refused.append(skill)
                self._finish(fields, jpeg)
                fails += 1
                if fails >= BACKOFF_AFTER:
                    self._wait(BACKOFF_S)
                    fails = 0
                continue
            fails = 0
            skill = fields["decision"]["skill"]
            if skill in MOVING:
                if not leases.use_move():
                    fields["safe_stop"] = {"reason": "402", "detail": f"no paid move ({leases.snapshot()})"}
                    self._finish(fields, jpeg)
                    # Nothing moves without money: wait for a payment before asking 0G again.
                    while not self.stopping.is_set() and not leases.money.ok():
                        self._wait(0.25)
                    continue
                with leases.lock:
                    used, txs = leases.money.used, list(leases.money.txs)
                fields["leases"]["money"] = True
                fields["move_index"] = used
                fields["money_tx"] = txs[used - 1] if len(txs) >= used else None
                self._face("moving")
                fields["executed"] = self._execute(fields["decision"], st["sonar_mm"])
                self.gap_mm = gap_after(fields["executed"], self.gap_mm)
                if battery_stop(fields["executed"]):
                    volts = self.rover.worker.call("state")["batt_mv"] / 1000
                    self.end_reason = (f"motor battery too low to drive ({volts:.1f} V)" if volts >= BATT_SENSE_LOST_V else
                                       f"no motor battery reading for 2 s ({volts:.1f} V): the motor switch is off, "
                                       "or the battery-sense wire (A0/GND) came loose")
                    fields["safe_stop"] = {"reason": "BAT", "detail": f"{self.end_reason}; mission ended"}
                    self.stopping.set()  # asking 0G again cannot help; the buyer sees the mission ended and why
                if skill in SCAN_PICKS:
                    self.sheet = None
                if fields["executed"].get("moved") is False:
                    leases.refund_move()
                    fields["executed"]["refunded"] = True
                    fields["move_index"] = fields["money_tx"] = None
                    self.last_actions.append(self._action(fields["executed"]))
                    self._finish(fields, jpeg)  # shows the BAT face when the battery ended the mission
                    if not self.end_reason:
                        self._face("STOP")
                        self._wait(HOLD_S)
                    continue
                self.moves += 1
            elif skill == "photo":
                fields["executed"], fields["photo"] = self._photo(full, seq)
                self.photo_yaws.append(st["yaw_cdeg"] - self.yaw0)
            else:
                fields["executed"] = {"skill": "stop", "args": [], "result": None, "stop_reason": None}
            self.last_actions.append(self._action(fields["executed"]))
            if skill in MOVING or skill == "photo":
                self.refused = []
            self._finish(fields, jpeg)
        with leases.lock:
            leases.brain = leases.proof = False

    def _execute(self, d: dict, sonar_mm: int = -1) -> dict:
        skills = self.rover.skills
        skill, args = d["skill"], []
        before = self.rover.worker.call("state")["start_ms"]
        try:
            if skill == "approach":
                args = [d["target"], d["stop_cm"] if d["stop_cm"] is not None else DEFAULT_STOP_CM]
                result = skills.approach(*args, expected_mm=approach_expected(self.gap_mm, sonar_mm))
            elif skill == "turn":
                args = [d["target"]]
                result = skills.face_target(d["target"])
            elif skill == "scan":
                if sweep_next(self.scanned, self.orbited, self.sweep_missed):
                    # Lost while going round (a turn a few degrees off leaves the box outside the camera's 43 deg): look
                    # 90 deg each side first, 7 views instead of a full 12-view circle.
                    result = self._keep_scan(skills.sweep(SWEEP_VIEWS, SWEEP_SPAN_DEG), SWEEP_VIEWS)
                else:
                    result = self._keep_scan(skills.scan(SCAN_VIEWS), SCAN_VIEWS)
            elif skill in SCAN_PICKS:
                args = [d["view"]]
                yaw = self.sheet["yaws"][d["view"] - 1]
                result = skills.face_view(yaw) if skill == "face_view" else skills.explore(yaw)
            elif skill == "back_off":
                result = skills.back_off()
            elif skill == "orbit_leg":
                direction, chosen_by = self._orbit_direction(d.get("orbit"))
                self.last_orbit, self.orbited = direction, True
                args = [direction]
                result = {**skills.orbit_leg(direction, self.gap_mm), "direction_by": chosen_by, "requested": d.get("orbit")}
            else:
                raise SkillError(f"no skill {skill!r}")
        except (SkillError, McuError) as e:
            moved = self.rover.worker.call("state")["start_ms"] != before  # a refused first command starts nothing
            return {"skill": skill, "args": args, "result": None, "stop_reason": None, "error": str(e)[:200], "moved": moved}
        steps = result.get("steps", [])
        self.wheel_mm += sum(abs(s.get("dist_mm", 0)) for s in steps if s.get("cmd", "").startswith("drive"))
        last = steps[-1] if steps else {}
        return {"skill": skill, "args": args, "result": result, "stop_reason": last.get("stop_reason")}

    def _keep_scan(self, result: dict, expected: int) -> dict:
        """The views go to 0G as one sheet at the next checkpoint; the record keeps their headings and the sheet hash."""
        views = result.pop("views")
        result["views"] = [{"n": n, "yaw_cdeg": v["yaw_cdeg"] - self.yaw0, "sonar_mm": v["sonar_mm"]}
                           for n, v in enumerate(views, 1)]
        if len(views) == expected:
            if not result.get("sweep"):
                self.scanned, self.sweep_missed = True, False
            jpeg = self.rover.camera.sheet([v["frame"] for v in views])
            self.sheet = {"jpeg": jpeg, "at": time.monotonic(), "yaws": [v["yaw_cdeg"] for v in views],
                          "sonar": [v["sonar_mm"] for v in views]}
            result["sheet_sha256"] = hashlib.sha256(jpeg).hexdigest()
        return result

    def _number_check(self, full: bytes, box: list[int]) -> dict:
        """Before a photo is paid, 0G reads the number on a close-up crop of the box it named, without being told which
        number is wanted (a live run, photo 3: it named #3 for an unnumbered box across the room). The reading is
        TEE-proven like a decision and kept in the record."""
        check = {"prompt_version": NUMBER_PROMPT_VERSION, "box": box, "margin_pct": 15, "number": None, "ok": False,
                 "proof": {}}
        try:
            crop = crop_box(full, box)
            check["crop_sha256"] = hashlib.sha256(crop).hexdigest()
            info = self.rover.brain.read_number(crop, new_nonce())
            check.update({"request_id": info["request_id"], "chat_id": info["chat_id"], "raw_response": info["raw_response"],
                          "latency_ms": info["t_reply_ms"] - info["t_sent_ms"], "number": info["number"]})
            check["proof"], _ = self.rover.prover.verify(info["chat_id"])
        except (BrainError, ProofError, ValueError) as e:
            check["error"] = str(e)[:120]
            if isinstance(e, ProofError):
                check["proof"] = e.proof
            elif isinstance(e, BrainError) and e.info:
                check.update({k: e.info[k] for k in ("request_id", "chat_id", "raw_response") if e.info.get(k)})
            return check
        check["ok"] = bool(check["proof"].get("verified")) and same_number(check["number"], parcel_number(self.info["mission"]))
        return check

    def _photo(self, full: bytes, seq: int) -> tuple[dict, dict | None]:
        """The full-resolution version of the very frame 0G judged, not a new capture after the decision."""
        n = len(self.rover.photos) + 1
        sha = hashlib.sha256(full).hexdigest()
        self.rover.photos[n] = {"jpeg": full, "sha256": sha, "seq": seq}
        photo = {"n": n, "sha256": sha}
        return {"skill": "photo", "args": [], "result": photo, "stop_reason": None}, photo

    def _finish(self, fields: dict, jpeg: bytes) -> None:
        record = self.chain.append(fields)
        self.checkpoints += 1
        stop = record["safe_stop"]
        if stop:
            self.safe_stops[stop["reason"]] = self.safe_stops.get(stop["reason"], 0) + 1
            self._face(stop["reason"])
        else:
            self._face("ready")
        self.rover.last_request_id = record["request_id"]
        self.rover.last_record_hash = record["hash"]
        d = record["decision"] or {}
        self.last = {"seq": record["seq"], "skill": d.get("skill"), "see": d.get("see"), "safe_stop": stop and stop["reason"],
                     "latency_ms": record["latency_ms"], "move_index": record["move_index"]}
        log.info("checkpoint %d: %s", record["seq"], json.dumps(self.last))
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        with open(EVIDENCE / "records.jsonl", "a") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        if self.rover.zglog:
            self.rover.zglog.record(record, jpeg)
            if record["photo"]:
                n = record["photo"]["n"]
                self.rover.zglog.photo(record["episode_id"], n, self.rover.photos[n]["jpeg"])
# 2026-11-06T03:02:00
# 2026-11-06T16:05:00
# 2026-11-06T23:02:04
