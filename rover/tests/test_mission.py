import threading
import time
import unittest

from rover.core.mcu import McuError
from rover.core.mission import (IMU_OK, ImuNotSteady, Mission, approach_expected, attempted_skill, battery_stop, explore_views, gap_after,
                                steady_imu_cal, sweep_next)
from rover.zg.brain import BrainError
from rover.zg.proof import ProofError
from rover.zg.prompt import SKILLS
from rover.zg.records import canonical
from rover.tests.test_camera import jpeg


def allowed(last_actions, yaw_deg=0, photo_yaws_deg=(), sonar_mm=300, scanned=True, photos_wanted=20, refused=()):
    m = Mission.__new__(Mission)
    m.info = {"photos_wanted": photos_wanted}  # 20: half a leg between photos, the floor of the spacing rule
    m.scanned, m.refused = scanned, list(refused)
    m.last_actions = last_actions
    m.photo_yaws = [y * 100 for y in photo_yaws_deg]
    return m._allowed(yaw_deg * 100, sonar_mm)


class Allowed(unittest.TestCase):
    def test_no_photo_twice_from_one_spot(self):
        self.assertNotIn("photo", allowed(["approach", "photo"], 3, [3]))

    def test_rejection_note_does_not_lift_a_ban(self):
        # A live run, seq 25-27: a rejected second photo, then the same photo slipped through
        self.assertNotIn("photo", allowed(["photo", "rejected: skill 'photo' not allowed"], 3, [3]))
        self.assertNotIn("approach", allowed(["orbit_leg:left", "rejected: turn without a target"], 40, [0]))

    def test_photo_side_by_heading(self):
        # A live run: photos at 3°, 191°, then orbit right (229°) and left back to 192°: same side as photo 2
        self.assertNotIn("photo", allowed(["photo", "orbit_leg:right", "orbit_leg:left"], 192, [3, 191]))
        self.assertIn("photo", allowed(["photo", "orbit_leg:right"], 229, [3, 191]))
        self.assertNotIn("photo", allowed(["turn"], 202, [3, 191]))  # a small turn stays on the same side
        self.assertNotIn("photo", allowed(["orbit_leg:right"], 361, [3]))  # all the way round

    def test_no_approach_right_after_one_that_found_the_parcel_close(self):
        self.assertNotIn("approach", allowed(["scan", "face_view", "approach:skipped"]))
        self.assertIn("approach", allowed(["scan", "face_view", "approach:skipped", "turn"], sonar_mm=900))

    def test_no_approach_right_after_an_orbit_once_photographed(self):
        self.assertNotIn("approach", allowed(["photo", "orbit_leg:left"], 40, [0]))
        self.assertNotIn("approach", allowed(["orbit_leg:right:blocked"], 40, [0]))
        self.assertIn("photo", allowed(["orbit_leg:left"], 40, [0]))

    def test_before_the_first_photo_approach_follows_an_orbit(self):
        # A live run: a reflex stop, then four orbits at ~1 m because approach was barred
        self.assertIn("approach", allowed(["approach:blocked", "orbit_leg:right"], 40, (), 930))

    def test_after_a_photo_approach_needs_an_echo_within_a_metre(self):
        # A live run, seq 5 (214 cm) and 24 (no echo, the suitcase) drove blind; another run, seq 6 (62 cm) was right
        self.assertNotIn("approach", allowed(["photo", "turn"], 40, [0], 2140))
        self.assertNotIn("approach", allowed(["photo", "turn"], 40, [0], -1))
        self.assertIn("approach", allowed(["photo", "turn"], 40, [0], 620))

    def test_first_approach_is_free(self):
        self.assertIn("approach", allowed([], 0, (), 930))
        self.assertIn("approach", allowed(["scan", "face_view"], 0, (), -1))

    def test_a_new_side_needs_a_finished_orbit_leg(self):
        # A live run: a bad IMU calibration turned the heading -151 deg between photos while the rover stood still
        self.assertNotIn("photo", allowed(["scan:refused", "approach:refused", "photo"], -676, [-525]))
        self.assertNotIn("photo", allowed(["photo", "orbit_leg:refused"], 60, [0]))
        self.assertNotIn("photo", allowed(["photo", "orbit_leg:right:blocked"], 60, [0]))
        self.assertIn("photo", allowed(["photo", "orbit_leg:right:blocked", "orbit_leg:left"], 60, [0]))

    def test_0g_is_told_why(self):
        m = Mission.__new__(Mission)
        m.info, m.last_actions, m.photo_yaws = {"photos_wanted": 5}, ["photo", "scan"], [0]
        self.assertEqual(m._photo_refusal(9000), "no orbit_leg finished since photo 1; orbit_leg to a new side first")
        self.assertEqual(m._photo_refusal(-2000), "photo 1 was taken 20 deg round from here and photos go 30 deg apart; "
                                                  "orbit_leg on, about 1 more")
        m.photo_yaws = []
        self.assertIsNone(m._photo_refusal(500))

    def test_the_first_move_is_a_scan(self):
        # A live run: started facing away from #3, 0G took a wall marker for it from the first frame
        self.assertEqual(allowed([], 0, (), 930, scanned=False), ["scan", "stop"])
        self.assertIn("approach", allowed(["scan", "face_view"], 0, (), 930))

    def test_photos_about_one_orbit_leg_apart(self):
        # A live run: corner views 34-71° round were refused under the old 96° spacing for 3 photos; a leg turns 33-36°
        for wanted in (3, 5):
            self.assertIn("photo", allowed(["photo", "orbit_leg:left"], 33, [0], photos_wanted=wanted))
            self.assertIn("photo", allowed(["photo", "orbit_leg:left"], 44, [0], photos_wanted=wanted))
            self.assertNotIn("photo", allowed(["photo", "orbit_leg:left"], 25, [0], photos_wanted=wanted))
        self.assertNotIn("photo", allowed(["photo", "orbit_leg:left", "orbit_leg:left"], 155, [170, 80], photos_wanted=5))

    def test_the_last_photos_always_have_a_side(self):
        # A live run: photos at 191°, 116°, 3° and 267° left no 57° side; half the largest arc (113°) less half a leg
        photos = [191, 116, 3, 267]
        self.assertIn("photo", allowed(["photo", "orbit_leg:left"], 50, photos, photos_wanted=5))
        self.assertNotIn("photo", allowed(["photo", "orbit_leg:left"], 30, photos, photos_wanted=5))

    def test_blocked_both_ways_half_a_leg_again(self):
        # a parcel by a wall: only part of the circle can be reached
        boxed_in = ["photo", "orbit_leg:left:blocked", "orbit_leg:right:blocked", "orbit_leg:left"]
        self.assertIn("photo", allowed(boxed_in, -25, [0], photos_wanted=5))
        # blocked one way only, the rover turns back and the circle is open: the full spacing stays (a live run)
        self.assertNotIn("photo", allowed(["photo", "orbit_leg:right:blocked", "orbit_leg:left"], -25, [0], photos_wanted=5))

    def test_a_skill_refused_twice_is_off_the_list(self):
        # A live run, seq 22-29: "turn" asked for eight times in a row after the rover said the parcel was centred
        self.assertIn("turn", allowed(["photo", "orbit_leg:right"], 90, [0], refused=["turn"]))
        self.assertNotIn("turn", allowed(["photo", "orbit_leg:right"], 90, [0], refused=["turn", "photo", "turn"]))
        self.assertEqual(attempted_skill('{"see":"x","skill":"turn","target":[300,150,700,850]}'), "turn")
        self.assertIsNone(attempted_skill("not json"))

    def test_back_off_only_straight_after_driving_in(self):
        # it reverses blind, so only over ground just crossed
        self.assertIn("back_off", allowed(["scan", "face_view", "approach"], 0, (), 300))
        self.assertIn("back_off", allowed(["photo", "orbit_leg:right"], 90, [0]))
        self.assertIn("back_off", allowed(["photo", "orbit_leg:right", "turn"], 90, [0]))  # a turn in place since
        for last in (["approach", "back_off"], ["orbit_leg:right:refused"], ["photo"], ["scan"], [],
                     ["approach", "back_off", "turn"], ["approach", "photo", "turn"], ["scan", "face_view", "turn"]):
            self.assertNotIn("back_off", allowed(last, 90, [0]))

    def test_no_approach_straight_after_backing_off(self):
        # A live run, seq 6-18: approach, back_off, approach, back_off ... four times
        self.assertNotIn("approach", allowed(["scan", "face_view", "approach", "back_off"], 0, (), 500))
        self.assertNotIn("approach", allowed(["approach", "back_off", "turn"], 0, (), 500))
        self.assertIn("approach", allowed(["approach", "back_off", "orbit_leg:left"], 0, (), 500))
        self.assertIn("approach", allowed(["approach", "back_off", "photo", "turn"], 0, (), 500))

    def test_everything_otherwise(self):
        no_back_off = [s for s in SKILLS if s != "back_off"]
        self.assertEqual(allowed([]), no_back_off)
        self.assertEqual(allowed(["photo", "orbit_leg:left", "scan"], 90, [0]), no_back_off)


class SameSide(unittest.TestCase):
    def test_names_the_photo_from_this_side(self):
        m = Mission.__new__(Mission)
        m.info, m.last_actions, m.photo_yaws = {"photos_wanted": 20}, [], [0, 9000, 18000]
        self.assertEqual(m._same_side(500), 1)
        self.assertEqual(m._same_side(17000), 3)
        self.assertIsNone(m._same_side(-4000))
        self.assertEqual(m._same_side(36000 + 100), 1)


def orbit_direction(last_actions, last_orbit, orbited, requested):
    m = Mission.__new__(Mission)
    m.last_actions, m.last_orbit, m.orbited = last_actions, last_orbit, orbited
    return m._orbit_direction(requested)


class OrbitDirection(unittest.TestCase):
    def test_first_leg_goes_where_0g_says(self):
        self.assertEqual(orbit_direction(["approach", "photo"], "left", False, "right"), ("right", "0G (first leg)"))

    def test_then_the_rover_keeps_going_round(self):
        # A live run: 0G alternated left/right between two photographed sides
        self.assertEqual(orbit_direction(["orbit_leg:right", "photo"], "right", True, "left")[0], "right")

    def test_a_blocked_leg_reverses(self):
        self.assertEqual(orbit_direction(["orbit_leg:right:blocked"], "right", True, "right"),
                         ("left", "rover: reversed after a blocked leg"))
        self.assertEqual(orbit_direction(["orbit_leg:left:blocked", "orbit_leg:right"], "right", True, "left")[0], "right")


class Action(unittest.TestCase):
    def test_skipped_approach(self):
        executed = {"skill": "approach", "result": {"skipped": "expected already 477 mm", "steps": [{"cmd": "turn_deg", "stop_reason": "done"}]}}
        self.assertEqual(Mission._action(executed), "approach:skipped")

    def test_blocked_explore(self):
        executed = {"skill": "explore", "result": {"blocked": True, "steps": [{"cmd": "turn_deg", "stop_reason": "done"}]}}
        self.assertEqual(Mission._action(executed), "explore:blocked")

    def test_path_blocked_orbit_reports_blocked(self):
        executed = {"skill": "orbit_leg", "result": {"direction": "right", "blocked": True, "steps": [
            {"cmd": "turn_deg", "stop_reason": "done"}, {"cmd": "turn_deg", "stop_reason": "done"}]}}
        self.assertEqual(Mission._action(executed), "orbit_leg:right:blocked")

    def test_reflex_reports_blocked(self):
        executed = {"skill": "orbit_leg", "result": {"direction": "left", "blocked": False, "steps": [
            {"cmd": "turn_deg", "stop_reason": "done"}, {"cmd": "drive_cm", "stop_reason": "reflex"}]}}
        self.assertEqual(Mission._action(executed), "orbit_leg:left:blocked")

    def test_stalled_turn(self):
        executed = {"skill": "scan", "result": {"steps": [{"cmd": "turn_deg", "stop_reason": "done"}, {"cmd": "turn_deg", "stop_reason": "stall"}]}}
        self.assertEqual(Mission._action(executed), "scan:stalled")

    def test_refused_move(self):
        executed = {"skill": "orbit_leg", "result": None, "error": "turn_deg(-72, 1500) refused: low_battery", "moved": False}
        self.assertEqual(Mission._action(executed), "orbit_leg:refused")

    def test_clear_orbit(self):
        executed = {"skill": "orbit_leg", "result": {"direction": "left", "blocked": False, "steps": [
            {"cmd": "turn_deg", "stop_reason": "done"}, {"cmd": "drive_cm", "stop_reason": "done"}]}}
        self.assertEqual(Mission._action(executed), "orbit_leg:left")


class GapAfter(unittest.TestCase):
    def test_approach_and_turn_measure_it(self):
        self.assertEqual(gap_after({"skill": "approach", "result": {"steps": [{"sonar_mm": 1900}, {"cmd": "drive_until", "sonar_mm": 310}]}}, None), 310)
        self.assertEqual(gap_after({"skill": "turn", "result": {"cmd": "turn_deg", "sonar_mm": 420}}, 300), 420)

    def test_a_missed_echo_keeps_it_on_an_orbit_but_not_after_an_approach(self):
        self.assertEqual(gap_after({"skill": "orbit_leg", "result": {"steps": [{"sonar_mm": 1290}]}}, 310), 310)
        self.assertEqual(gap_after({"skill": "turn", "result": {"cmd": "turn_deg", "skipped": "below minimum turn"}}, 310), 310)
        self.assertIsNone(gap_after({"skill": "approach", "result": {"steps": [{"sonar_mm": -1}]}}, 310))
        leg = {"skill": "orbit_leg", "result": {"gap_mm": 380, "gap_from": "sonar", "steps": [{"sonar_mm": -1}]}}
        self.assertEqual(gap_after(leg, None), 380)  # measured at the leg's start

    def test_an_approach_whose_echo_ran_past_the_parcel_dead_reckons(self):
        # A live run, seq 3: planned on 98 cm, drove 50.3 cm, then the sonar read the room behind the box (196 cm)
        approach = {"skill": "approach", "result": {"plan_mm": 980, "steps": [
            {"cmd": "turn_deg", "dist_mm": 503, "sonar_mm": -1}, {"cmd": "drive_until", "dist_mm": 503, "sonar_mm": 1960}]}}
        self.assertEqual(gap_after(approach, None), 477)

    def test_an_impossible_distance_forgets_the_gap(self):
        bad = {"skill": "back_off", "result": {"steps": [{"cmd": "drive_cm", "dist_mm": 2040109446, "sonar_mm": 1401}]}}
        self.assertIsNone(gap_after(bad, 579))  # A live run, seq 10
        approach = {"skill": "approach", "result": {"plan_mm": 980, "steps": [{"cmd": "drive_until", "dist_mm": 2040109446, "sonar_mm": -1}]}}
        self.assertIsNone(gap_after(approach, None))

    def test_a_first_approach_checks_against_what_0g_saw(self):
        self.assertEqual(approach_expected(None, 1230), 1230)  # A live run, seq 2
        self.assertEqual(approach_expected(477, 1960), 477)  # the dead-reckoned gap wins
        self.assertIsNone(approach_expected(None, -1))

    def test_lost_while_going_round_is_a_quick_look_first(self):
        self.assertTrue(sweep_next(scanned=True, orbited=True, sweep_missed=False))
        self.assertFalse(sweep_next(scanned=False, orbited=True, sweep_missed=False))  # the mission's first scan
        self.assertFalse(sweep_next(scanned=True, orbited=False, sweep_missed=False))  # not going round yet
        self.assertFalse(sweep_next(scanned=True, orbited=True, sweep_missed=True))  # the quick look found nothing

    def test_back_off_adds_what_it_reversed(self):
        self.assertEqual(gap_after({"skill": "back_off", "result": {"steps": [{"cmd": "drive_cm", "dist_mm": 202, "sonar_mm": 1740}]}}, 300), 502)
        self.assertIsNone(gap_after({"skill": "back_off", "result": {"steps": [{"dist_mm": 202}]}}, None))

    def test_elsewhere_forgets_it_and_a_refusal_keeps_it(self):
        self.assertIsNone(gap_after({"skill": "scan", "result": {"steps": [{"sonar_mm": 400}]}}, 300))
        self.assertIsNone(gap_after({"skill": "explore", "result": {"steps": [{"sonar_mm": 400}]}}, 300))
        self.assertEqual(gap_after({"skill": "orbit_leg", "result": None, "error": "refused", "moved": False}, 300), 300)
        self.assertIsNone(gap_after({"skill": "orbit_leg", "result": None, "error": "imu", "moved": True}, 300))


class AllPhotosTaken(unittest.TestCase):
    def test_the_rover_waits_for_the_end(self):
        # A live run: after photo 5 it asked 0G again and drove a prepaid orbit leg until the buyer's end cut it
        calls = []

        class Worker:
            def call(self, cmd, *args):
                calls.append(cmd)
                return {"yaw_cdeg": 0}

            def submit(self, cmd, *args):
                calls.append((cmd, *args))

        class Leases:
            lock, brain, proof = threading.Lock(), True, True

        rover = type("Rover", (), {"worker": Worker(), "leases": Leases(), "photos": {1: {}, 2: {}}})()
        m = Mission.__new__(Mission)
        m.rover, m.info, m.stopping = rover, {"photos_wanted": 2}, threading.Event()
        t = threading.Thread(target=m._run)
        t.start()
        time.sleep(0.2)
        self.assertTrue(t.is_alive())  # the buyer still sees it running until it pays and ends
        m.stopping.set()
        t.join(1)
        self.assertFalse(t.is_alive())
        self.assertEqual(calls, ["state", ("face", "DONE")])  # no camera, no 0G, no move
        self.assertFalse(rover.leases.brain or rover.leases.proof)


class BatteryStop(unittest.TestCase):
    def test_refusal_or_halt_for_the_battery(self):
        # A live run: every move refused at 0.0 V
        self.assertTrue(battery_stop({"skill": "scan", "error": "turn_deg(30, 1500) refused: low_battery", "moved": False}))
        self.assertTrue(battery_stop({"skill": "approach", "result": {"steps": [{"cmd": "drive_until", "stop_reason": "battery"}]}}))
        self.assertFalse(battery_stop({"skill": "turn", "error": "turn_deg(30, 1500) refused: no_cal", "moved": False}))
        self.assertFalse(battery_stop({"skill": "approach", "result": {"steps": [{"cmd": "drive_until", "stop_reason": "reflex"}]}}))


class FakeImu:
    """imu_cal returns the next bias; the heading then turns at that calibration's drift (deg/s). A calibration given as
    "fail" raises like the MCU's refused imu_cal; one given as "reset" passes, but the chip resets during the check."""

    def __init__(self, cals):
        self.cals, self.calls, self.drift, self.at = list(cals), 0, 0.0, 0.0
        self.resets, self.reset_due, self.ok = 0, False, True

    def call(self, name, timeout=None):
        if name == "imu_cal":
            cal = self.cals[self.calls]
            self.calls += 1
            if cal == "fail":
                raise McuError("imu_cal failed: IMU missing, or the rover was moving")
            self.reset_due, self.ok = cal == "reset", True
            bias, self.drift = (6369, 0.0) if self.reset_due else cal
            self.at = time.monotonic()
            return bias
        if self.reset_due and time.monotonic() - self.at > 0.01:
            self.resets, self.reset_due, self.ok = self.resets + 1, False, False
        return {"yaw_cdeg": round(self.drift * 100 * (time.monotonic() - self.at)), "flags": IMU_OK if self.ok else 0,
                "imu_resets": self.resets, "imu_bus_errors": 0}


class SteadyImuCal(unittest.TestCase):
    def test_still_rover(self):
        imu = FakeImu([(6369, 0.0)])  # standing still: 0.97 deg/s bias
        self.assertEqual(steady_imu_cal(imu, settle_s=0.05)["bias_cdps"], 97)
        self.assertEqual(imu.calls, 1)

    def test_the_result_fits_a_record(self):
        # A live run: a float in the recalibration note crashed the mission at the next record
        note = {"yaw_cdeg": 21285, **steady_imu_cal(FakeImu([(6665, 0.0)]), settle_s=0.05), "imu_resets": 4}
        canonical({"imu_recal": note})

    def test_carried_then_put_down(self):
        # A live run: calibrated while turned by hand, 3494 raw = 53 deg/s
        imu = FakeImu([(349404, -52.3), (6369, 0.0)])
        steady_imu_cal(imu, settle_s=0.05)
        self.assertEqual(imu.calls, 2)

    def test_never_steady(self):
        with self.assertRaisesRegex(ImuNotSteady, "keep the rover still"):
            steady_imu_cal(FakeImu([(349404, -52.3)] * 3), settle_s=0.05)
        with self.assertRaises(ImuNotSteady):  # a normal bias, but turned during the check
            steady_imu_cal(FakeImu([(6369, 4.0)] * 3), settle_s=0.05)

    def test_one_failed_calibration_is_retried(self):
        imu = FakeImu(["fail", (6369, 0.0)])
        self.assertEqual(steady_imu_cal(imu, settle_s=0.05)["bias_cdps"], 97)
        self.assertEqual(imu.calls, 2)

    def test_a_reset_during_the_check_is_not_steady(self):
        # a reset chip reads zeros: the heading holds perfectly still, so only the reset count and the flag show it
        imu = FakeImu(["reset", (6369, 0.0)])
        self.assertEqual(steady_imu_cal(imu, settle_s=0.05)["bias_cdps"], 97)
        self.assertEqual(imu.calls, 2)

    def test_a_faulty_gyro_is_named(self):
        with self.assertRaisesRegex(ImuNotSteady, "faulty: the gyro reset 1 times .* check the gyro's power"):
            steady_imu_cal(FakeImu(["reset"] * 3), settle_s=0.05)
        with self.assertRaisesRegex(ImuNotSteady, "faulty: calibration failed"):
            steady_imu_cal(FakeImu(["fail"] * 3), settle_s=0.05)


class FakeBrain:
    def __init__(self, number=None, error=None):
        self.number, self.error = number, error

    def read_number(self, crop, nonce):
        if self.error:
            raise self.error
        return {"request_id": "r-1", "chat_id": "c-1", "raw_response": "{}", "t_sent_ms": 1000, "t_reply_ms": 3400,
                "number": self.number}


class FakeProver:
    def __init__(self, fail=False):
        self.fail = fail

    def verify(self, chat_id):
        if self.fail:
            raise ProofError("signature fetch failed", {"verified": False, "signed_text": None})
        return {"verified": True, "signer": "0x7457"}, [12]


def number_check(brain, prover=None):
    m = Mission.__new__(Mission)
    m.info = {"mission": "Inspect parcel #3"}
    m.rover = type("R", (), {"brain": brain, "prover": prover or FakeProver()})()
    check = m._number_check(jpeg(), [250, 250, 750, 750])
    canonical({"number_check": check})  # it goes into the record: no floats
    return check


class NumberCheck(unittest.TestCase):
    def test_the_crop_must_read_the_parcel_number(self):
        # A live run, photo 3: 0G named #3 for an unnumbered box across the room
        self.assertTrue(number_check(FakeBrain("3"))["ok"])
        self.assertTrue(number_check(FakeBrain("#3"))["ok"])
        for read in (None, "1", "2"):
            check = number_check(FakeBrain(read))
            self.assertFalse(check["ok"])
            self.assertEqual(check["number"], read)

    def test_no_proof_or_no_answer_is_no_photo(self):
        self.assertFalse(number_check(FakeBrain("3"), FakeProver(fail=True))["ok"])
        check = number_check(FakeBrain(error=BrainError("request failed: ReadTimeout", {"request_id": "r-2"})))
        self.assertFalse(check["ok"])
        self.assertEqual((check["error"], check["request_id"]), ("request failed: ReadTimeout", "r-2"))


if __name__ == "__main__":
    unittest.main()
