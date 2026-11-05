import copy
import json
import unittest
from itertools import groupby
from pathlib import Path

from rover.zg.brain import BrainError, parcel_number, validate, validate_number, validate_scan
from rover.zg.prompt import MISSION, SCAN_PROMPT, SKILLS, SKILLS_V3, SWEEP_PROMPT
from rover.zg.records import canonical, record_hash, verify_chain

# Every record produced by rover/tools/zg_check.py on the UNO Q during P3 (0G mainnet).
FIXTURE = Path(__file__).with_name("fixtures") / "p3_records.jsonl"


def episodes():
    records = [json.loads(line) for line in FIXTURE.read_text().splitlines()]
    return [list(g) for _, g in groupby(records, key=lambda r: r["episode_id"])]


class P3Records(unittest.TestCase):
    def test_every_chain_verifies(self):
        eps = episodes()
        self.assertEqual(sum(len(e) for e in eps), 108)
        for e in eps:
            verify_chain(e)

    def test_a_changed_byte_breaks_the_chain(self):
        e = copy.deepcopy(max(episodes(), key=len))
        e[3]["raw_response"] = e[3]["raw_response"].replace("search_turn", "approach")
        with self.assertRaises(ValueError):
            verify_chain(e)

    def test_floats_are_rejected(self):
        r = copy.deepcopy(episodes()[0][0])
        r["latency_ms"] = 2486.5
        with self.assertRaises(TypeError):
            record_hash(r)

    def test_canonical_is_sorted_compact_utf8(self):
        self.assertEqual(canonical({"b": 1, "a": ["é", None, True]}), '{"a":["é",null,true],"b":1}'.encode())

    def test_failed_checkpoints_are_safe_stops(self):
        stops = {r["safe_stop"]["reason"] for e in episodes() for r in e if r["safe_stop"]}
        self.assertEqual(stops, {"!TEE", "0G?"})
        for e in episodes():
            for r in e:
                self.assertEqual(r["safe_stop"] is None, r["proof"]["verified"])


class Validate(unittest.TestCase):
    def test_real_replies_validate_with_their_nonce(self):
        for e in episodes():
            for r in e:
                if r["decision"] and r.get("test_fault") != "wrong_nonce":
                    got = validate(r["raw_response"], r["nonce"], allowed=SKILLS_V3, framing=False)  # P3 predates v5
                    got.pop("orbit", None)  # added in v3; P3 records predate it
                    self.assertEqual(got, r["decision"])

    def test_wrong_nonce_is_rejected(self):
        r = next(r for e in episodes() for r in e if r["decision"])
        with self.assertRaises(BrainError):
            validate(r["raw_response"], "00000000")

    def test_approach_needs_a_target(self):
        with self.assertRaises(BrainError):
            validate('{"see":"x","skill":"approach","target":null,"stop_cm":30,"reason":"x","nonce":"ab12cd34"}', "ab12cd34")

    def test_orbit_direction(self):
        reply = '{"see":"x","skill":"orbit_leg","target":null,"stop_cm":null,"reason":"x","nonce":"ab12cd34","orbit":"right"}'
        self.assertEqual(validate(reply, "ab12cd34")["orbit"], "right")
        with self.assertRaises(BrainError):
            validate(reply.replace('"right"', '"up"'), "ab12cd34")

    def test_orbit_keeps_its_direction(self):
        reply = '{"see":"x","skill":"orbit_leg","target":null,"stop_cm":null,"reason":"x","nonce":"ab12cd34","orbit":"left"}'
        with self.assertRaises(BrainError):
            validate(reply, "ab12cd34", orbit="right")
        self.assertEqual(validate(reply, "ab12cd34", orbit="left")["orbit"], "left")
        self.assertIsNone(validate(reply.replace('"left"', 'null'), "ab12cd34", orbit="right")["orbit"])

    def test_disallowed_skill_is_rejected(self):
        with self.assertRaises(BrainError):
            validate('{"see":"x","skill":"photo","target":null,"stop_cm":null,"reason":"x","nonce":"ab12cd34"}', "ab12cd34",
                     allowed=("orbit_leg", "stop"))

    def photo(self, target):
        return json.dumps({"see": "x", "skill": "photo", "target": target, "stop_cm": None, "reason": "x", "nonce": "ab12cd34"})

    def test_photo_needs_a_centred_parcel(self):
        self.assertEqual(validate(self.photo([200, 0, 800, 1000]), "ab12cd34")["target"], [200, 0, 800, 1000])
        self.assertEqual(validate(self.photo([100, 0, 850, 1000]), "ab12cd34")["target"], [100, 0, 850, 1000])  # photo 5
        # Three edges without a back_off allowed (a live run, seq 8: just backed off, a wall behind): the crop check decides.
        no_back_off = tuple(s for s in SKILLS if s != "back_off")
        self.assertEqual(validate(self.photo([10, 10, 900, 990]), "ab12cd34", allowed=no_back_off)["target"], [10, 10, 900, 990])
        with self.assertRaises(BrainError):  # wider than the frame: never
            validate(self.photo([0, 0, 1000, 1000]), "ab12cd34", allowed=no_back_off)
        for target, why in (([0, 0, 150, 1000], "left edge"), ([700, 100, 1000, 900], "right edge"),
                            ([450, 400, 550, 600], "too small"), (None, "without a target"),
                            ([0, 0, 1000, 1000], "fills the frame; back_off"),  # A live run, photo 2: the "3" alone
                            ([200, 0, 1000, 1000], "fills the frame; back_off")):  # A live run, photo 2: half the "#3"
            with self.assertRaises(BrainError) as e:
                validate(self.photo(target), "ab12cd34")
            self.assertIn(why, str(e.exception))
            self.assertLessEqual(len(f"rejected: {e.exception}"), 60)  # it must fit last_actions

    def test_a_photo_names_the_parcel_number(self):
        # A live run, photo 3: a plain box under a bed, paid as parcel #3
        reply = lambda n: json.dumps({"see": "x", "skill": "photo", "target": [250, 200, 750, 900], "stop_cm": None,
                                      "reason": "x", "number": n, "nonce": "ab12cd34"})
        for n in ("3", 3, "#3", " #3 "):
            self.assertEqual(validate(reply(n), "ab12cd34", number="3")["number"], str(n))
        for n in ("1", None, "8"):
            with self.assertRaises(BrainError) as e:
                validate(reply(n), "ab12cd34", number="3")
            self.assertIn("#3 not readable", str(e.exception))
            self.assertLessEqual(len(f"rejected: {e.exception}"), 60)

    def test_the_crop_reading(self):
        reply = lambda n, nonce="ab12cd34": json.dumps({"see": "x", "number": n, "nonce": nonce})
        self.assertEqual(validate_number(reply("3"), "ab12cd34"), "3")
        self.assertEqual(validate_number(reply(3), "ab12cd34"), "3")
        self.assertEqual(validate_number(reply("#1"), "ab12cd34"), "#1")
        for n in (None, "", "null"):
            self.assertIsNone(validate_number(reply(n), "ab12cd34"))
        with self.assertRaises(BrainError):
            validate_number(reply("3", "ffffffff"), "ab12cd34")
        with self.assertRaises(BrainError):
            validate_number(reply(True), "ab12cd34")

    def test_a_parcel_stands_on_the_floor(self):
        # A live run: a black wall marker taken for the parcel, approached (box ending at 490) and photographed (150)
        approach = '{"see":"x","skill":"approach","target":[400,350,600,490],"stop_cm":30,"reason":"x","nonce":"ab12cd34"}'
        for reply in (approach, self.photo([300, 0, 700, 540])):
            with self.assertRaises(BrainError) as e:
                validate(reply, "ab12cd34")
            self.assertIn("above the floor", str(e.exception))
            self.assertLessEqual(len(f"rejected: {e.exception}"), 60)
        self.assertEqual(validate(approach.replace("490", "850"), "ab12cd34")["skill"], "approach")
        self.assertEqual(validate(approach, "ab12cd34", framing=False)["skill"], "approach")  # replaying old replies

    def test_search_turn_is_gone_in_v4(self):
        with self.assertRaises(BrainError):
            validate('{"see":"x","skill":"search_turn","target":null,"stop_cm":null,"reason":"x","nonce":"ab12cd34"}', "ab12cd34")

    def test_unknown_skill_is_rejected(self):
        with self.assertRaises(BrainError):
            validate('{"see":"x","skill":"fly","target":null,"stop_cm":null,"reason":"x","nonce":"ab12cd34"}', "ab12cd34")


class ValidateScan(unittest.TestCase):
    def reply(self, view, explore, number="3"):
        return json.dumps({"see": "x", "view": view, "number": number, "explore": explore, "reason": "x",
                           "nonce": "ab12cd34"})

    def test_parcel_view_is_faced(self):
        self.assertEqual(validate_scan(self.reply(5, None), "ab12cd34", number="3"),
                         {"see": "x", "skill": "face_view", "view": 5, "number": "3", "reason": "x"})
        self.assertEqual(validate_scan(self.reply(5, None, "#3"), "ab12cd34", number="3")["view"], 5)

    def test_a_view_needs_the_mission_number(self):
        # a scan's round 3: a plain box taken for #3
        for read in (None, "", "1", "#1", "33"):
            with self.assertRaises(BrainError):
                validate_scan(self.reply(8, None, read), "ab12cd34", number="3")

    def test_explore_only_where_there_is_room(self):
        self.assertEqual(validate_scan(self.reply(None, 7), "ab12cd34", explore_views=[2, 7])["view"], 7)
        with self.assertRaises(BrainError):
            validate_scan(self.reply(None, 6), "ab12cd34", explore_views=[2, 7])

    def test_a_sweep_names_its_seven_views_or_none(self):
        self.assertEqual(validate_scan(self.reply(7, None), "ab12cd34", number="3", views=7, explore_views=[])["view"], 7)
        with self.assertRaises(BrainError):
            validate_scan(self.reply(8, None), "ab12cd34", number="3", views=7, explore_views=[])
        with self.assertRaisesRegex(BrainError, "^sweep: parcel not within 90 deg either side"):
            validate_scan(self.reply(None, None), "ab12cd34", number="3", views=7, explore_views=[])
        with self.assertRaisesRegex(BrainError, "^scan reply names no photo"):
            validate_scan(self.reply(None, None), "ab12cd34", number="3")

    def test_the_sweep_prompt_is_the_scan_prompt_with_its_own_opening(self):
        self.assertIn("7 photos, 30 degrees apart, from its far left (photo 1) to its far right (photo 7)", SWEEP_PROMPT)
        self.assertIn("view and explore are both null", SWEEP_PROMPT)
        self.assertNotIn("full circle", SWEEP_PROMPT)
        self.assertIn("full circle", SCAN_PROMPT)

    def test_parcel_number_from_the_mission(self):
        self.assertEqual(parcel_number(MISSION), "3")

    def test_no_parcel_explores(self):
        self.assertEqual(validate_scan(self.reply(None, 2), "ab12cd34")["skill"], "explore")

    def test_a_parcel_view_wins_over_explore(self):
        self.assertEqual(validate_scan(self.reply(3, 7), "ab12cd34")["view"], 3)

    def test_out_of_range_and_empty_are_rejected(self):
        for view, explore in ((13, None), (0, None), (None, None), ("5", None), (2.5, None)):
            with self.assertRaises(BrainError):
                validate_scan(self.reply(view, explore), "ab12cd34")


if __name__ == "__main__":
    unittest.main()
