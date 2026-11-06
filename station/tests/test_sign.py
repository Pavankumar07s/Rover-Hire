import unittest

from station.bridge import BridgeError, parse
from station.sampler import light_pct_x100
from station.sign import Signer, canonical, recover

KEY = "0x" + "11" * 32  # a test key, never used for anything real


class SignTest(unittest.TestCase):
    def setUp(self):
        self.signer = Signer(KEY)
        self.signed = self.signer.sign({"v": 1, "station": "station-a", "seq": 7, "t_aht_cc": 2915, "p_pa": None})

    def test_recovers_to_the_signer(self):
        self.assertEqual(recover(self.signed), self.signer.address)

    def test_one_changed_byte_fails(self):
        tampered = {**self.signed, "t_aht_cc": 2916}
        self.assertNotEqual(recover(tampered), self.signer.address)

    def test_canonical_is_sorted_and_compact(self):
        self.assertEqual(canonical({"b": 1, "a": [2, None]}), '{"a":[2,null],"b":1}')

    def test_floats_are_refused(self):
        with self.assertRaises(TypeError):
            canonical({"t": 29.1})


class ParseTest(unittest.TestCase):
    def test_thirteen_fields(self):
        s = parse("2915,7127,2947,0,442,0,0,0,1,1,60000,59500,0")
        self.assertEqual((s.t_aht_cc, s.ok_press, s.sample_age_ms), (2915, 0, 500))

    def test_old_firmware_is_caught(self):
        with self.assertRaises(BridgeError):
            parse("2915,7127,2947,0,442,0,0,0,1,1,60000,59500")

    def test_light_scale(self):
        self.assertEqual((light_pct_x100(1023), light_pct_x100(758), light_pct_x100(30), light_pct_x100(0)), (0, 0, 10000, 10000))
        self.assertEqual(light_pct_x100(394), 5000)  # halfway between dark and bright


if __name__ == "__main__":
    unittest.main()
