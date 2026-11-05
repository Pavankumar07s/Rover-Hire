import time
import unittest

from rover.core.bridge import McuWorker


class FakeMcu:
    def __init__(self):
        self.ms = 1000

    def heartbeat(self, seq):
        return 0

    def state(self):
        self.ms += 50
        return {"ms": self.ms}


class Connect(unittest.TestCase):
    def test_a_failed_first_push_reconnects_and_ends_connected(self):
        # flash: the first set_cal after the MCU restarted timed out; the worker must try again from the start
        pushes = []

        def on_connect(mcu):
            pushes.append(mcu)
            if len(pushes) == 1:
                raise TimeoutError("Request 'set_cal' timed out after 1.0s")

        w = McuWorker(connect_fn=FakeMcu, require_kick=False, on_connect=on_connect).start()
        try:
            end = time.monotonic() + 4
            while not w.connected and time.monotonic() < end:
                time.sleep(0.05)
            self.assertTrue(w.connected)
            self.assertEqual(len(pushes), 2)
            self.assertIsNot(pushes[0], pushes[1])  # a fresh link, not the half-open one
        finally:
            w.stop()


if __name__ == "__main__":
    unittest.main()
