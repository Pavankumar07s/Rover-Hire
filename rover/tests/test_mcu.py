import json
import tempfile
import unittest
from pathlib import Path

from rover.core.calibration import CALIBRATION_FILE, load
from rover.core.mcu import FLAG_BATTERY, FLAG_IMU_PRESENT, Mcu, McuError, parse_state

# Captured from the rover's MCU (build 20:14:11), 5 s after boot: IMU not yet calibrated.
REAL_STATE = "5428,0,0,0,0,0,0,0,0,90,339,339,8252,0,0,0,1,17,80,8245,8245,0,0"


class ParseState(unittest.TestCase):
    def test_real_line(self):
        s = parse_state(REAL_STATE)
        self.assertEqual(s["ms"], 5428)
        self.assertEqual(s["mode_name"], "idle")
        self.assertEqual(s["stop_name"], "none")
        self.assertEqual(s["sonar_mm"], 339)
        self.assertEqual(s["batt_mv"], 8252)
        self.assertEqual(s["flags"], FLAG_IMU_PRESENT | FLAG_BATTERY)
        self.assertEqual(s["imu_resets"], 0)
        self.assertEqual(s["imu_bus_errors"], 0)

    def test_field_count_mismatch_is_an_error(self):
        with self.assertRaises(McuError):
            parse_state(REAL_STATE + ",7")


class FakeBridge:
    def __init__(self):
        self.calls = []

    def call(self, name, *args, timeout=None):
        self.calls.append((name, args))
        return 0


class SetCal(unittest.TestCase):
    def test_turn_settings_go_in_set_cal2(self):
        bridge = FakeBridge()
        cal = load(turn_kick_pct=80)
        Mcu(bridge).set_cal(cal)
        (first, args1), (second, args2), (third, args3) = bridge.calls
        self.assertEqual((first, len(args1)), ("set_cal", 10))  # the firmware's argument order and count
        self.assertEqual(args1[6], cal.turn_pct)
        self.assertEqual((second, args2), ("set_cal2", (80, cal.stall_cdps, cal.stall_ms, cal.drive_lag_ms, cal.roll_ms)))
        self.assertEqual((third, args3), ("set_cal3", (cal.turn_brake_k_x1000, cal.turn_brake_q_div, cal.reflex_base_mm,
                                                       cal.sonar_offset_mm, cal.trim_pct)))

    def test_a_file_without_the_suite_values_gets_the_firmware_defaults(self):
        with tempfile.TemporaryDirectory() as d:
            values = {k: v for k, v in json.loads(CALIBRATION_FILE.read_text())["values"].items()
                      if k not in ("turn_brake_k_x1000", "turn_brake_q_div", "reflex_base_mm", "sonar_offset_mm", "trim_pct")}
            f = Path(d) / "calibration.json"
            f.write_text(json.dumps({"values": values}))
            cal = load(f)
        self.assertEqual((cal.turn_brake_k_x1000, cal.turn_brake_q_div, cal.reflex_base_mm, cal.sonar_offset_mm, cal.trim_pct),
                         (55, 370370, 120, -18, 0))


class HaltInfo(unittest.TestCase):
    def test_parses_the_firmware_line(self):
        class Bridge:
            def call(self, name, *args, timeout=None):
                return "123456,3,-15400,9012,9000"
        self.assertEqual(Mcu(Bridge()).halt_info(), {"halt_ms": 123456, "mode_name": "turn", "rate_cdps": -15400,
                                                    "yaw_cdeg": 9012, "turn_target_cdeg": 9000})


if __name__ == "__main__":
    unittest.main()
