"""Encoder counts, live, while wheels are turned by hand (no motors). Stop rover.service first.
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.enc_hand [seconds]"""
import sys
import time

from rover.tools.floor_test import Session

secs = float(sys.argv[1]) if len(sys.argv) > 1 else 45
s = Session()
s.beat()
st = s.mcu.state()
l0, r0 = st["enc_l"], st["enc_r"]
t0 = time.monotonic()
next_print = 0.0
while time.monotonic() - t0 < secs:
    s.beat()
    st = s.mcu.state()
    if time.monotonic() >= next_print:
        print(f"{time.monotonic() - t0:4.0f}s  left {st['enc_l'] - l0:5d}   right {st['enc_r'] - r0:5d}", flush=True)
        next_print = time.monotonic() + 1.0
    time.sleep(0.05)
print(f"total  left {st['enc_l'] - l0}   right {st['enc_r'] - r0}", flush=True)
