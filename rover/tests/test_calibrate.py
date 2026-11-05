import json
import math
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

import rover.tools.calibrate as calibrate
from rover.core import calibration
from rover.tools.calibrate import (bearing_after_turn, choose_kp, heat_check, fit_brake, gap_trend, grip_values, hfov_from_shift,
                                   image_shift, lead_fit, pivot_for_flat, SkillsWorker, trim_from, wheel_findings, wiring_problems)


def pulses(**over):
    """S1 rows as a healthy rover gives them: a side alone pivots the rover away from it, both forward closes the gap."""
    rows = {"left": {"l": 30, "r": 2, "yaw": -6.0, "moved_mm": 10}, "right": {"l": 1, "r": 28, "yaw": 5.5, "moved_mm": 12},
            "both": {"l": 40, "r": 38, "yaw": 0.3, "moved_mm": 60}, "spin_left": {"l": 20, "r": 22, "yaw": 9.0, "moved_mm": 0},
            "spin_right": {"l": 21, "r": 20, "yaw": -8.5, "moved_mm": 0}}
    for step, change in over.items():
        rows[step] = {**rows[step], **change}
    return rows


class Wiring(unittest.TestCase):
    def test_a_healthy_rover_has_no_problems(self):
        self.assertEqual(wiring_problems(pulses()), [])

    def test_the_3_nov_reversed_right_pair(self):
        # both right wheels ran backward, so "right forward" pivoted the rover the wrong way and spins went nowhere
        found = wiring_problems(pulses(right={"yaw": -5.0}, spin_left={"yaw": 0.4}, spin_right={"yaw": -0.2}, both={"moved_mm": 2}))
        self.assertIn("the right side runs backward: swap its two motor wires at the L298N", found)
        self.assertNotIn("the left side runs backward: swap its two motor wires at the L298N", found)

    def test_swapped_encoders(self):
        found = wiring_problems(pulses(left={"l": 1, "r": 30}, right={"l": 28, "r": 0}))
        self.assertIn("the encoders are swapped: the left side's edges arrive on the right input (left must be D2, right D4)", found)

    def test_a_dead_side(self):
        found = wiring_problems(pulses(left={"l": 0, "r": 0, "yaw": 0.1}))
        self.assertEqual(found[0], "the left side does not move: its motor wires, its L298N output or its EN/IN pins")

    def test_a_dead_encoder_on_a_working_side(self):
        found = wiring_problems(pulses(right={"r": 0, "l": 1}))
        self.assertIn("the right encoder counts nothing while its side moves: its OUT wire or its pin", found)


class Rules(unittest.TestCase):
    def test_grip_values_add_the_margin_and_cap_at_100(self):
        v = grip_values(drive_start=55, keep_rolling=40, turn_ok=70, cruise_pct=38)
        self.assertEqual(v, {"kick_pct": 70, "floor_pct": 45, "cruise_pct": 45, "turn_pct": 85, "turn_kick_pct": 100})
        self.assertEqual(grip_values(35, 25, 100, 38)["turn_pct"], 100)  # capped
        self.assertEqual(grip_values(35, 25, 55, 38)["cruise_pct"], 38)  # cruise stays when above the floor

    def test_trim_goes_to_the_slower_side(self):
        self.assertEqual(trim_from(500, 500, 38), 0)
        self.assertEqual(trim_from(450, 500, 38), 4)    # left 10 % slower: +4 % on the left
        self.assertEqual(trim_from(500, 450, 38), -4)   # right slower: on the right
        self.assertEqual(trim_from(100, 500, 38), 15)   # capped

    def test_choose_kp(self):
        drives = [{"kp_x10": 0, "drift_deg_per_50cm": 2.0}, {"kp_x10": 15, "drift_deg_per_50cm": 1.0},
                  {"kp_x10": 30, "drift_deg_per_50cm": 0.5}]
        self.assertEqual(choose_kp(drives, trim=0), 0)
        self.assertEqual(choose_kp(drives, trim=3), 15)  # the kp 0 drive ran without the trim
        self.assertIsNone(choose_kp([{"kp_x10": 15, "drift_deg_per_50cm": 4}], trim=0))

    def test_lead_fit_on_the_p2_points(self):
        # P2 (calibration.json skill_sources): least squares 28 + 0.178 x travel, rms 11 mm
        base, per, top, rms = lead_fit([(363, 88), (108, 57), (168, 42), (296, 93)], per_mm_now=0.178)
        self.assertEqual((base, per), (28, 0.178))
        self.assertEqual(top, 95)
        self.assertAlmostEqual(rms, 11, delta=1)

    def test_lead_fit_keeps_the_slope_when_the_travels_are_close(self):
        base, per, _, _ = lead_fit([(500, 100), (520, 104), (510, 98)], per_mm_now=0.178)
        self.assertEqual(per, 0.178)
        self.assertEqual(base, 10)

    def test_fit_brake_recovers_the_p1_rule(self):
        points = [(r, 55 * r / 1000 + r * r / 370370) for r in (4000, 7000, 9000, 12000, 15000, 18000)]
        k, q, rms = fit_brake(points)
        self.assertEqual(k, 55)
        self.assertAlmostEqual(q, 370370, delta=2000)
        self.assertLess(rms, 0.05)

    def test_fit_brake_never_gives_a_negative_term(self):
        k, q, _ = fit_brake([(5000, 900), (10000, 800), (15000, 700)])  # coast falling with speed: nonsense, kept in range
        self.assertGreaterEqual(k, 0)
        self.assertLessEqual(q, 5_000_000)

    def test_wheel_findings_on_the_3_nov_wheels_up_run(self):
        # wheels in the air: at 30 % the right pair ran 33 % slower and drew less current
        problems, notes = wheel_findings([
            {"pct": 30, "left_edges_per_s": 102.6, "right_edges_per_s": 68.5, "left_dip_mv": 68, "right_dip_mv": 38},
            {"pct": 50, "left_edges_per_s": 201.4, "right_edges_per_s": 197.4, "left_dip_mv": 122, "right_dip_mv": 106}])
        self.assertEqual(problems, [])
        self.assertEqual(notes, ["at 30 % the right side runs 33 % slower than the left; it draws less current too: a bad contact (front-left)"])

    def test_wheel_findings_on_the_first_suite_run(self):
        # calibrate wheels after the right pair's wires were swapped: the new front-left gearbox is stiff
        problems, notes = wheel_findings([
            {"pct": 38, "left_edges_per_s": 141.5, "right_edges_per_s": 204.5, "left_dip_mv": 116, "right_dip_mv": 25},
            {"pct": 100, "left_edges_per_s": 259.4, "right_edges_per_s": 283.8, "left_dip_mv": 105, "right_dip_mv": 113}])
        self.assertEqual(problems, [])
        self.assertEqual(notes, ["at 38 % the left side runs 31 % slower than the right; it draws more current too: a stiff gearbox (run it in or oil it)"])

    def test_a_dead_encoder_fails(self):
        problems, _ = wheel_findings([{"pct": 75, "left_edges_per_s": 0, "right_edges_per_s": 250, "left_dip_mv": 110, "right_dip_mv": 115}])
        self.assertEqual(problems, ["at 75 % the left encoder counts nothing: a dead side, or its encoder wire"])


class Heat(unittest.TestCase):
    def test_a_fading_driver_stops_the_turns(self):
        # S6: the 90 deg turn peaked 175 deg/s, then 86 deg/s about 30 turns later
        peaks = []
        for deg, peak in ((45, 174.1), (-45, 162.3), (90, 175.1), (-90, 173.2), (15, 60.0)):
            heat_check(peaks, deg, {"stop": "done", "peak_dps": peak})  # a short turn never reaches full speed: not judged
        heat_check(peaks, 135, {"stop": "stall", "peak_dps": 20.0})  # a stall counts elsewhere
        with self.assertRaises(calibrate.Abort):
            heat_check(peaks, -90, {"stop": "done", "peak_dps": 85.8})


class Orbit(unittest.TestCase):
    def test_gap_trend_is_the_change_per_leg(self):
        legs = [{"leg": n, "gap_mm": g} for n, g in enumerate((450, 441, 429, 420, 412, 399))]
        self.assertAlmostEqual(gap_trend(legs), -10.0, delta=0.5)

    def test_gap_trend_skips_legs_the_sonar_missed_and_needs_three(self):
        legs = [{"leg": 0, "gap_mm": 450}, {"leg": 1, "gap_mm": None}, {"leg": 2, "gap_mm": 470}, {"leg": 3, "gap_mm": 480}]
        self.assertAlmostEqual(gap_trend(legs), 10.0, delta=0.5)
        self.assertIsNone(gap_trend(legs[:2]))

    def test_pivot_where_the_gap_stays_flat(self):
        self.assertEqual(pivot_for_flat(120, -20, 220, 0), 220)
        self.assertEqual(pivot_for_flat(120, -10, 220, 10), 170)
        self.assertEqual(pivot_for_flat(120, 15, 20, -5), 45)  # the second series below the first

    def test_no_pivot_when_the_gap_does_not_follow_it(self):
        self.assertIsNone(pivot_for_flat(120, -10, 220, -20))  # a bigger circle spiralled in faster: not the pivot
        self.assertIsNone(pivot_for_flat(120, -10, 220, -8))   # 2 mm per leg apart: noise
        self.assertIsNone(pivot_for_flat(120, None, 220, 4))


class Worker(unittest.TestCase):
    def test_skills_calls_reach_the_suites_mcu_with_a_heartbeat(self):
        from rover.core.calibration import load

        class Suite:
            def __init__(self):
                self.pushed, self.beats, self.calls = [], 0, []
                self.s = self
                self.mcu = self

            def beat(self):
                self.beats += 1

            def push(self, **temp):
                self.pushed.append(temp)

            def turn_deg(self, deg, lease_ms):
                self.calls.append(("turn_deg", deg, lease_ms))

        x = Suite()
        w = SkillsWorker(x)
        w.call("turn_deg", 72, 1500)
        w.call("set_cal", load(turn_pct=100, turn_kick_pct=100))  # a stalled turn's boost
        w.call("set_cal", load())  # and back
        self.assertEqual(x.calls, [("turn_deg", 72, 1500)])
        self.assertEqual(x.pushed, [{"turn_pct": 100, "turn_kick_pct": 100}, {}])
        self.assertEqual(x.beats, 3)


def seen_after_turn(yaw_deg, depth_mm, pivot_mm):
    """Independent of the code under test: the lens pivot_mm ahead of the pivot, a point depth_mm ahead of the lens; turn
    left by yaw and give the point's bearing from the new heading (+ = to the right) by vectors."""
    t = math.radians(yaw_deg)
    heading = (-math.sin(t), math.cos(t))
    lens = (pivot_mm * heading[0], pivot_mm * heading[1])
    v = (0 - lens[0], pivot_mm + depth_mm - lens[1])
    along = v[0] * heading[0] + v[1] * heading[1]
    right = v[0] * heading[1] - v[1] * heading[0]
    return math.degrees(math.atan2(right, along))


class FieldOfView(unittest.TestCase):
    def test_bearing_matches_the_vector_model(self):
        for yaw, depth, pivot in ((10, 1500, 120), (8.6, 1000, 200), (12, 3000, 0)):
            self.assertAlmostEqual(bearing_after_turn(yaw, depth, pivot), seen_after_turn(yaw, depth, pivot), places=6)

    def test_a_near_wall_moves_further_than_the_turn(self):
        self.assertAlmostEqual(bearing_after_turn(10, 1500, 0), 10.0, places=6)
        self.assertGreater(bearing_after_turn(10, 1500, 120), 10.7)  # 8 % more at 1.5 m: uncorrected, hfov would read ~3 deg small

    def test_hfov_from_a_pinhole_shift(self):
        f = 320 / math.tan(math.radians(43.1 / 2))  # the measured value at 640 px
        shift = f * math.tan(math.radians(seen_after_turn(9.4, 1400, 120)))
        self.assertAlmostEqual(hfov_from_shift(shift, 9.4, 640, 1400, 120), 43.1, places=3)
        self.assertAlmostEqual(hfov_from_shift(-shift, -9.4, 640, 1400, 120), 43.1, places=3)


class ImageShift(unittest.TestCase):
    def scene(self, w=900, h=480, seed=3):
        rng = np.random.default_rng(seed)
        small = rng.integers(0, 255, (h // 8, w // 8), dtype=np.uint8)
        return np.kron(small, np.ones((8, 8), np.uint8))  # blocky texture, like print on a box

    def test_finds_how_far_the_middle_moved(self):
        world = self.scene()
        before, after = world[:, 100:740], world[:, 37:677]  # the camera looked 63 px further left: the scene moved right
        shift, score, texture = image_shift(before, after)
        self.assertAlmostEqual(shift, 63, delta=0.5)
        self.assertGreater(score, 0.95)
        self.assertGreater(texture, 30)

    def test_a_plain_wall_has_no_texture(self):
        wall = np.full((480, 640), 180, np.uint8)
        _, _, texture = image_shift(wall, wall)
        self.assertLess(texture, 1)


class FakeSuite:
    """Just enough of Suite for run_stages and write: no rover."""

    def __init__(self, out):
        self.file = json.loads(calibrate.CALIBRATION_FILE.read_text())
        self.base = calibration.load(calibrate.CALIBRATION_FILE)
        self.fit, self.notes, self.skills, self.skill_notes, self.camera = {}, {}, {}, {}, {}
        self.applied, self.backed_up = [], set()
        self.day, self.place, self.power, self.out, self.resets = "2026-11-05", "venue", None, out, 0
        self.mcu = mock.Mock()
        self.mcu.state.return_value = {"imu_resets": 0}

    def push(self, **temp):
        pass

    def set(self, key, value, note):
        self.fit[key], self.notes[key] = value, note

    def calibrate_imu(self):
        return 0

    def log(self, stage, row):
        pass


def stage(sets, ok=True):
    def run(x):
        for k, v in sets.items():
            x.set(k, v, "test")
        return calibrate.result({}, [] if ok else ["it failed"])
    run.__doc__ = "a test stage"
    return run


class Apply(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        for name in ("calibration.json", "camera.json"):
            shutil.copy(Path(calibrate.__file__).parents[1] / "core" / name, self.dir / name)
        self.patches = [mock.patch.object(calibrate, "CALIBRATION_FILE", self.dir / "calibration.json"),
                        mock.patch.object(calibrate, "CANDIDATE", self.dir / "calibration.candidate.json"),
                        mock.patch.object(calibrate, "CAMERA_FILE", self.dir / "camera.json")]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.dir)

    def values(self):
        return json.loads((self.dir / "calibration.json").read_text())

    def test_each_passing_stage_is_written_and_a_failure_keeps_them(self):
        before = self.values()["values"]
        stages = {"S0": stage({}), "S3": stage({"turn_pct": 90, "kick_pct": 55}), "S6": stage({"turn_brake_k_x1000": 70}, ok=False)}
        with mock.patch.dict(calibrate.STAGES, stages):
            x = FakeSuite(self.dir)
            results = calibrate.run_stages(x, ["S0", "S3", "S6"], apply=True)
        data = self.values()
        self.assertEqual(x.applied, ["S0", "S3"])
        self.assertFalse(results["S6"]["pass"])
        self.assertEqual((data["values"]["turn_pct"], data["values"]["kick_pct"]), (90, 55))  # S3 applied
        self.assertEqual(data["values"]["turn_brake_k_x1000"], before["turn_brake_k_x1000"])  # S6 failed: not applied
        self.assertEqual(data["values"]["cruise_mm_s"], before["cruise_mm_s"])  # untouched stages keep the home run's values
        self.assertEqual(data["suite"]["date"], "2026-11-05")
        self.assertIn("(S0, S3)", data["status"])
        self.assertEqual(len(list(self.dir.glob("calibration.before-*.json"))), 1)  # one backup, from before the first write

    def test_without_apply_a_subset_writes_only_the_candidate(self):
        before = (self.dir / "calibration.json").read_text()
        with mock.patch.dict(calibrate.STAGES, {"S3": stage({"turn_pct": 90})}):
            x = FakeSuite(self.dir)
            results = calibrate.run_stages(x, ["S3"])
            calibrate.write(x, results, False)
        self.assertEqual((self.dir / "calibration.json").read_text(), before)
        self.assertEqual(json.loads((self.dir / "calibration.candidate.json").read_text())["values"]["turn_pct"], 90)


if __name__ == "__main__":
    unittest.main()
