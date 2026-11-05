import unittest

from rover.core.calibration import load
from rover.core.skills import MIN_TURN_DEG, sweep_offsets_cdeg, Skills, bbox_heading_deg, brake_mm, orbit_gap, sonar_lead_mm


class BboxHeading(unittest.TestCase):
    def test_centred_box_needs_no_turn(self):
        self.assertAlmostEqual(bbox_heading_deg([400, 100, 600, 300], 60), 0.0)

    def test_frame_edge_is_half_the_fov(self):
        self.assertAlmostEqual(bbox_heading_deg([1000, 0, 1000, 100], 50), -25.0)

    def test_box_on_the_right_turns_right(self):
        self.assertAlmostEqual(bbox_heading_deg([700, 0, 800, 100], 60), -16.1, places=1)

    def test_box_on_the_left_turns_left(self):
        self.assertAlmostEqual(bbox_heading_deg([200, 0, 300, 100], 60), 16.1, places=1)

    def test_real_0g_target(self):
        # 0gm-1.0 answer on the bench "parcel ahead" scene (zg_decisions_main.jsonl, run 1).
        self.assertAlmostEqual(bbox_heading_deg([220, 130, 560, 420], 60), 7.2, places=1)



class TargetTurn(unittest.TestCase):
    def test_centred_parcels_need_no_turn(self):
        # A live run, seq 14-18: four paid turns of 0 deg (hfov 43.1); seq 10 turned -16 deg
        skills = Skills(None, None, None, 43.1)
        for box in ([350, 250, 650, 750], [250, 200, 750, 900], [350, 200, 650, 800], [300, 200, 700, 900]):
            self.assertLess(abs(skills.target_turn_deg(box)), MIN_TURN_DEG)
        self.assertEqual(skills.target_turn_deg([750, 200, 1000, 800]), -16)


class Brake(unittest.TestCase):
    def test_matches_the_firmware_reflex(self):
        # rover_mcu.ino reflexMm(): 120 + cruise_mm_s * 4 / 10 at cruise (284 mm/s measured in P2)
        self.assertEqual(brake_mm(), 120 + load().cruise_mm_s * 4 // 10)


class SonarLead(unittest.TestCase):
    # Measured overshoots (P2): travel 363 mm -> 88 mm, 108 -> 57, 168 -> 42, 296 -> 93.
    def test_long_drive_reaches_the_cap(self):
        self.assertEqual(sonar_lead_mm(363), 93)

    def test_short_drive_coasts_less(self):
        self.assertEqual(sonar_lead_mm(108), 47)

    def test_unknown_distance_uses_the_cap(self):
        self.assertEqual(sonar_lead_mm(None), 95)

    def test_cap(self):
        self.assertEqual(sonar_lead_mm(600), 95)


if __name__ == "__main__":
    unittest.main()


class OrbitGap(unittest.TestCase):
    def test_sonar_on_the_parcel(self):
        self.assertEqual(orbit_gap(393, 520), (393, "sonar"))

    def test_sonar_past_the_parcel_uses_the_remembered_gap(self):
        # A live run, cp 31: the sonar read 174 cm (the wall behind) right after a back-off from a 30 cm gap
        self.assertEqual(orbit_gap(1740, 500), (500, "remembered"))
        self.assertEqual(orbit_gap(-1, 500), (500, "remembered"))

    def test_nothing_known_uses_the_default(self):
        self.assertEqual(orbit_gap(-1, None), (450, "default"))


class Turntable:
    """A fake MCU that turns exactly as asked, and a camera with a new frame on every look."""

    def __init__(self):
        self.yaw, self.start, self.seq = 0, 0, 0

    def call(self, name, *args, timeout=None):
        if name == "state":
            return {"start_ms": self.start, "mode_name": "idle", "stop_name": "done", "yaw_cdeg": self.yaw, "rate_cdps": 0,
                    "dist_mm": 0, "sonar_mm": 900, "batt_min_mv": 8000}
        if name == "turn_deg":
            self.start += 1
            self.yaw += args[0] * 100
        return 0

    def latest(self):
        self.seq += 1
        return "frame", 0.0, self.seq


class Sweep(unittest.TestCase):
    def test_views_from_far_left_to_far_right(self):
        self.assertEqual(sweep_offsets_cdeg(7, 90), [9000, 6000, 3000, 0, -3000, -6000, -9000])

    def test_seven_still_frames_round_where_it_began(self):
        t = Turntable()
        t.yaw = 12000
        res = Skills(t, t, lambda: (True, None), 43.1).sweep(7, 90)
        self.assertTrue(res["sweep"])
        self.assertEqual([v["yaw_cdeg"] for v in res["views"]], [21000, 18000, 15000, 12000, 9000, 6000, 3000])


class Floor:
    """A fake MCU with the parcel straight ahead at sonar_mm; records the drives it is asked for."""

    def __init__(self, sonar_mm):
        self.sonar, self.drives, self.start = sonar_mm, [], 0

    def call(self, name, *args, timeout=None):
        if name == "state":
            return {"start_ms": self.start, "mode_name": "idle", "stop_name": "done", "yaw_cdeg": 0, "rate_cdps": 0,
                    "dist_mm": 0, "sonar_mm": self.sonar, "batt_min_mv": 8000}
        if name == "drive_until":
            self.start += 1
            self.drives.append(args[:2])
        return 0


class Approach(unittest.TestCase):
    def approach(self, sonar_mm, stop_cm):
        floor = Floor(sonar_mm)
        return Skills(floor, None, lambda: (True, None), 43.1).approach([450, 300, 550, 700], stop_cm), floor

    def test_30_cm_asked_stops_at_45(self):
        # A live run: 0G asked for 30 cm three times; at 30 cm the box filled the frame
        res, floor = self.approach(800, 30)
        self.assertEqual(res["stop_cm"], 45)
        self.assertEqual(floor.drives, [(45, 450 + sonar_lead_mm(350))])

    def test_already_close_enough_does_not_drive(self):
        res, floor = self.approach(460, 30)
        self.assertEqual((floor.drives, res["skipped"]), ([], "sonar already 460 mm"))

    def expect(self, sonar_mm, expected_mm):
        floor = Floor(sonar_mm)
        return Skills(floor, None, lambda: (True, None), 43.1).approach([450, 300, 550, 700], 30, expected_mm), floor

    def test_a_reading_past_the_dead_reckoned_gap_is_the_room(self):
        # A live run, seq 4: about 48 cm left by dead reckoning, the sonar read the wall at 199 cm; it drove 50 cm
        res, floor = self.expect(1986, 477)
        self.assertEqual((floor.drives, res["plan_from"], res["skipped"]), ([], "expected", "expected already 477 mm"))

    def test_a_reading_near_the_dead_reckoned_gap_is_trusted(self):
        res, floor = self.expect(900, 950)
        self.assertEqual((res["plan_from"], floor.drives), ("sonar", [(50, 450 + sonar_lead_mm(450))]))

    def test_no_echo_drives_on_the_expected_gap_blind_capped(self):
        res, floor = self.expect(-1, 900)
        self.assertEqual((res["plan_from"], floor.drives), ("expected", [(25, 450 + sonar_lead_mm(450))]))

    def test_no_echo_and_nothing_known_stays_blind(self):
        res, floor = self.expect(-1, None)
        self.assertEqual((res["plan_from"], floor.drives), ("blind", [(25, 450 + sonar_lead_mm(None))]))



class GrippyFloor:
    """A fake MCU on a floor that holds the tyres below a turn power: turn_deg finishes the turn at or above it and
    stalls having turned nothing below it, at whatever power the last set_cal pushed."""

    def __init__(self, needs_pct):
        self.needs, self.pct, self.yaw, self.start, self.stop, self.cals = needs_pct, load().turn_pct, 0, 0, "none", []

    def call(self, name, *args, timeout=None):
        if name == "state":
            return {"start_ms": self.start, "mode_name": "idle", "stop_name": self.stop, "yaw_cdeg": self.yaw,
                    "rate_cdps": 0, "dist_mm": 0, "sonar_mm": -1, "batt_min_mv": 8000}
        if name == "set_cal":
            self.pct = args[0].turn_pct
            self.cals.append((args[0].turn_pct, args[0].turn_kick_pct))
        elif name == "turn_deg":
            self.start += 1
            self.stop = "done" if self.pct >= self.needs else "stall"
            self.yaw += args[0] * 100 if self.stop == "done" else 0
        return 0


class BoostedTurn(unittest.TestCase):
    def turn(self, needs_pct):
        floor = GrippyFloor(needs_pct)
        return Skills(floor, None, lambda: (True, None), 43.1).turn(30), floor

    def test_a_normal_floor_needs_no_boost(self):
        res, floor = self.turn(load().turn_pct)
        self.assertEqual((res["stop_reason"], res["yaw_change_cdeg"], floor.cals), ("done", 3000, []))
        self.assertNotIn("boosts", res)

    def test_a_wiped_floor_turns_at_85(self):
        if load().turn_pct >= 85:
            self.skipTest("normal turns already run at 85 % (heavier rover)")
        res, floor = self.turn(85)
        normal = (load().turn_pct, load().turn_kick_pct)
        self.assertEqual((res["stop_reason"], res["yaw_change_cdeg"]), ("done", 3000))
        self.assertEqual(floor.cals, [(85, 100), normal])  # boosted, then the normal calibration back
        self.assertEqual([b["turn_pct"] for b in res["boosts"]], [85])

    def test_then_100(self):
        res, floor = self.turn(100)
        normal = (load().turn_pct, load().turn_kick_pct)
        self.assertEqual(res["stop_reason"], "done")
        self.assertEqual(floor.cals, [(85, 100), normal, (100, 100), normal])

    def test_a_floor_it_cannot_turn_on_still_ends_as_a_stall(self):
        res, floor = self.turn(101)
        self.assertEqual((res["stop_reason"], res["yaw_change_cdeg"], len(res["boosts"])), ("stall", 0, 2))
        self.assertEqual(floor.cals[-1], (load().turn_pct, load().turn_kick_pct))
