import time
import unittest

from rover.core.lease import Leases


def leases_with(quote="q1", paid=0):
    lz = Leases()
    lz.money.quote_id = quote
    if paid:
        lz.set_paid(quote, paid, [f"tx{i}" for i in range(paid)])
    return lz


class MoneyLease(unittest.TestCase):
    def test_needs_a_paid_unused_move_and_a_fresh_heartbeat(self):
        lz = leases_with(paid=1)
        self.assertFalse(lz.money.ok())
        lz.money_heartbeat("q1")
        self.assertTrue(lz.money.ok())
        self.assertTrue(lz.use_move())
        self.assertFalse(lz.money.ok())
        self.assertFalse(lz.use_move())

    def test_heartbeat_expires_after_one_second(self):
        lz = leases_with(paid=2)
        lz.money_heartbeat("q1")
        self.assertFalse(lz.money.ok(now=time.monotonic() + 1.01))

    def test_paid_is_a_running_total(self):
        lz = leases_with(paid=3)
        lz.set_paid("q1", 2, [])
        self.assertEqual(lz.money.paid, 3)

    def test_wrong_quote_is_rejected(self):
        lz = leases_with()
        with self.assertRaises(ValueError):
            lz.set_paid("other", 1, [])
        with self.assertRaises(ValueError):
            lz.money_heartbeat("other")


class Gate(unittest.TestCase):
    def test_brain_then_proof_then_money(self):
        lz = leases_with(paid=1)
        self.assertEqual(lz.all_ok(moving=True), (False, "0G?"))
        lz.brain = True
        self.assertEqual(lz.all_ok(moving=True), (False, "!TEE"))
        lz.proof = True
        self.assertEqual(lz.all_ok(moving=True), (False, "402"))
        self.assertEqual(lz.all_ok(moving=False), (True, None))
        lz.money_heartbeat("q1")
        self.assertEqual(lz.all_ok(moving=True), (True, None))


if __name__ == "__main__":
    unittest.main()
