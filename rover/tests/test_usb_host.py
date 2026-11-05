import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "systemd" / "usb-host.sh"


class UsbHost(unittest.TestCase):
    def watch(self, role, seconds=0.6):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "role"
            f.write_text(role + "\n")
            env = {**os.environ, "USB_ROLE_FILE": str(f), "USB_ROLE_CHECK_S": "0.1"}
            p = subprocess.Popen(["sh", str(SCRIPT)], env=env)
            try:
                time.sleep(seconds)
            finally:
                p.kill()
                p.wait()
            return f.read_text().strip()

    def test_a_port_turned_device_goes_back_to_host(self):
        self.assertEqual(self.watch("device"), "host")

    def test_host_and_none_are_left_alone(self):
        self.assertEqual(self.watch("host"), "host")
        self.assertEqual(self.watch("none"), "none")


if __name__ == "__main__":
    unittest.main()
