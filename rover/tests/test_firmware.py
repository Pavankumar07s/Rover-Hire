import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKETCH = ROOT / "firmware" / "rover_mcu"


@unittest.skipUnless(shutil.which("g++"), "needs g++")
class Battery(unittest.TestCase):
    def test_battery_sense_logic_on_the_host(self):
        # firmware/tests/test_batt.cpp: the loose-wire dips and dropouts, a switched-off pack, a slow real drop
        with tempfile.TemporaryDirectory() as d:
            exe = Path(d) / "test_batt"
            subprocess.run(["g++", "-std=c++17", "-Wall", "-Werror", "-I", str(SKETCH), str(ROOT / "firmware/tests/test_batt.cpp"),
                            str(SKETCH / "batt.cpp"), "-o", str(exe)], check=True, capture_output=True)
            run = subprocess.run([str(exe)], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stdout)


if __name__ == "__main__":
    unittest.main()
