"""Protocol of firmware/rover_mcu over the Arduino Bridge (msgpack-RPC via arduino-router)."""

from dataclasses import astuple, dataclass

# Order must match cmdState() in firmware/rover_mcu/rover_mcu.ino.
STATE_FIELDS = (
    "ms", "mode", "stop_reason", "refusal", "start_ms", "halt_ms", "hb_ms", "lease_until_ms",
    "yaw_cdeg", "rate_cdps", "sonar_mm", "sonar_raw_mm", "batt_mv", "enc_l", "enc_r",
    "dist_mm", "face", "flags", "pings", "batt_now_mv", "batt_min_mv", "imu_resets", "imu_bus_errors",
)

MODES = {0: "idle", 1: "duty", 2: "drive", 3: "turn", 4: "brake"}
STOP_REASONS = {0: "none", 1: "cmd", 2: "lease", 3: "heartbeat", 4: "reflex", 5: "battery", 6: "done", 7: "imu", 8: "sonar", 9: "stall"}
REFUSALS = {0: "ok", 10: "no_heartbeat", 11: "no_imu", 12: "no_cal", 13: "low_battery", 14: "bad_arg", 20: "not_moving"}
FACES = {"idle": 0, "ready": 1, "thinking": 2, "moving": 3, "0G?": 10, "!TEE": 11, "402": 12,
         "STOP": 13, "DONE": 14, "BAT": 15}

FLAG_IMU_PRESENT, FLAG_IMU_OK, FLAG_CAL, FLAG_HEARTBEAT, FLAG_BATTERY = 1, 2, 4, 8, 16
FLAG_BATT_SENSE_LOST = 32  # the newest battery reading is under 4 V: the sense wire, the motor switch or the pack
IMU_FAILED = -999999


@dataclass(frozen=True)
class Calibration:
    cruise_pct: int
    cruise_mm_s: int
    batt_mv: int
    kick_pct: int
    kick_ms: int
    floor_pct: int
    turn_pct: int
    kp_x10: int
    brake_ms: int
    mm_per_edge_x100: int
    turn_kick_pct: int = 100  # set_cal2 from here on
    stall_cdps: int = 1000
    stall_ms: int = 400
    drive_lag_ms: int = 0
    roll_ms: int = 0
    turn_brake_k_x1000: int = 55  # set_cal3 from here on; defaults = firmware config.h
    turn_brake_q_div: int = 370370
    reflex_base_mm: int = 120
    sonar_offset_mm: int = -18
    trim_pct: int = 0


class McuError(RuntimeError):
    pass


def parse_state(text: str) -> dict:
    values = [int(v) for v in text.split(",")]
    if len(values) != len(STATE_FIELDS):
        raise McuError(f"state has {len(values)} fields, expected {len(STATE_FIELDS)}: {text!r}")
    state = dict(zip(STATE_FIELDS, values))
    state["mode_name"] = MODES.get(state["mode"], str(state["mode"]))
    state["stop_name"] = STOP_REASONS.get(state["stop_reason"], str(state["stop_reason"]))
    state["refusal_name"] = REFUSALS.get(state["refusal"], str(state["refusal"]))
    return state


class Mcu:
    """Thin typed wrapper. Not thread-safe: call it from one thread only."""

    def __init__(self, bridge, timeout: float = 1.0):
        self._bridge = bridge
        self._timeout = timeout

    def _call(self, name: str, *args):
        return self._bridge.call(name, *args, timeout=self._timeout)

    def _command(self, name: str, *args) -> int:
        code = int(self._call(name, *args))
        if code != 0:
            raise McuError(f"{name}{args} refused: {REFUSALS.get(code, code)}")
        return code

    def heartbeat(self, seq: int) -> int:
        return int(self._call("heartbeat", seq))

    def state(self) -> dict:
        return parse_state(str(self._call("state")))

    def info(self) -> str:
        return str(self._call("info"))

    def set_duty(self, left_pct: int, right_pct: int, lease_ms: int) -> None:
        self._command("set_duty", left_pct, right_pct, lease_ms)

    def drive_cm(self, cm: int, speed_pct: int, lease_ms: int) -> None:
        self._command("drive_cm", cm, speed_pct, lease_ms)

    def drive_until(self, max_cm: int, stop_mm: int, lease_ms: int) -> None:
        self._command("drive_until", max_cm, stop_mm, lease_ms)

    def drive_ms(self, ms: int, speed_pct: int, lease_ms: int) -> None:
        self._command("drive_ms", ms, speed_pct, lease_ms)

    def turn_deg(self, deg: int, lease_ms: int) -> None:
        self._command("turn_deg", deg, lease_ms)

    def lease(self, lease_ms: int) -> int:
        return int(self._call("lease", lease_ms))

    def stop(self) -> None:
        self._command("stop")

    def face(self, name: str) -> None:
        self._command("face", FACES[name])

    def imu_cal(self) -> int:
        bias_x100 = int(self._bridge.call("imu_cal", timeout=5))
        if bias_x100 == IMU_FAILED:
            raise McuError("imu_cal failed: IMU missing, or the rover was moving")
        return bias_x100

    def set_cal(self, cal: Calibration) -> None:
        values = astuple(cal)
        self._command("set_cal", *values[:10])
        self._command("set_cal2", *values[10:15])
        self._command("set_cal3", *values[15:])

    def halt_info(self) -> dict:
        ms, mode, rate, yaw, target = (int(v) for v in str(self._call("halt_info")).split(","))
        return {"halt_ms": ms, "mode_name": MODES.get(mode, str(mode)), "rate_cdps": rate, "yaw_cdeg": yaw, "turn_target_cdeg": target}

    def set_cutoff(self, mv: int) -> None:
        self._command("set_cutoff", mv)


def connect(timeout: float = 10.0) -> Mcu:
    from arduino.router_bridge import Bridge

    bridge = Bridge()
    if not bridge.connect(timeout=timeout):
        raise McuError("cannot reach /var/run/arduino-router.sock (router down, or user not in arduino-router)")
    return Mcu(bridge)
