import unittest
from unittest import mock

from rover.tools import venue_cal


def still(batt=8400, yaw=(0, 0), flags=31, resets=(0, 0)):
    return [{"ms": 0, "yaw_cdeg": yaw[0], "batt_now_mv": batt, "flags": flags, "imu_resets": resets[0]},
            {"ms": 2000, "yaw_cdeg": yaw[1], "batt_now_mv": batt, "flags": flags, "imu_resets": resets[1]}]


class Rover:
    def __init__(self, samples, target=1500, info="rover_mcu build=x,brake_k=55,brake_q=370370"):
        self.mcu = mock.Mock()
        self.mcu.info.return_value = info
        self.s = mock.Mock()
        self.s.pump.return_value = samples
        self.target = target

    def push(self, **temp):
        pass

    def calibrate_imu(self):
        return 0

    def sonar(self, seconds=1.5):
        return self.target


class Ready(unittest.TestCase):
    @mock.patch.object(venue_cal, "board_temp_c", return_value=40.0)
    def test_a_ready_rover(self, _):
        problems, summary = venue_cal.ready(Rover(still()))
        self.assertEqual(problems, [])
        self.assertEqual(summary["target_mm"], 1500)

    @mock.patch.object(venue_cal, "board_temp_c", return_value=40.0)
    def test_what_stops_it_before_moving(self, _):
        self.assertIn("charge it", venue_cal.ready(Rover(still(batt=7100)))[0][0])
        self.assertIn("gyro", venue_cal.ready(Rover(still(yaw=(0, 300))))[0][0])  # 1.5 deg/s drift
        self.assertIn("1.0-2.0 m", venue_cal.ready(Rover(still(), target=700))[0][0])
        self.assertIn("1.0-2.0 m", venue_cal.ready(Rover(still(), target=None))[0][0])
        self.assertIn("flash it", venue_cal.ready(Rover(still(), info="rover_mcu build=old"))[0][0])

    def test_the_stages_and_their_order(self):
        self.assertEqual(venue_cal.STAGES, ("S3", "S6"))  # drives are measured by the encoders (checked with a tape)


class Stages(unittest.TestCase):
    def run_with(self, verdicts):
        ran = []

        def fake(x, names, apply=False):
            ran.append(names[0])
            return {names[0]: {"pass": verdicts[names[0]]}}

        with mock.patch.object(venue_cal.cal, "run_stages", side_effect=fake), mock.patch.object(venue_cal, "rest") as rest:
            results = venue_cal.stages(mock.Mock(), rest_s=300)
        return ran, results, rest

    def test_s6_runs_after_the_rest(self):
        ran, results, rest = self.run_with({"S3": True, "S6": True})
        self.assertEqual(ran, ["S3", "S6"])
        rest.assert_called_once()

    def test_a_failed_s3_stops_the_run(self):
        ran, _, rest = self.run_with({"S3": False, "S6": True})
        self.assertEqual(ran, ["S3"])
        rest.assert_not_called()


if __name__ == "__main__":
    unittest.main()
