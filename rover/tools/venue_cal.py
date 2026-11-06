"""The venue's floor calibration: only what a new floor changes, on top of the calibration made at home.
    S3 floor grip    the start push and the turn power
    (a rest: the L298N cools)
    S6 turns         how far a turn coasts after braking
Drives are not re-measured: the encoders measure their length (by tape: 30.0, 40.3 and 50.0 cm). Each stage
that passes is written to calibration.json at once; a failed S3 stops the run, because S6 turns at S3's power. The rest
is for the L298N: it faded twice after ~30 turns in a row.
On the UNO Q, the rover square to a wall or a big flat box 1.0-2.0 m ahead, 50 cm clear all round:
    venv/bin/python -m rover.tools.venue_cal --go [--place venue] [--rest-s 300]        about 9 min with the rest
Without --go it prints what it needs and moves nothing. Evidence: evidence/CAL/<date>-<place>-floor/.
"""

import argparse
import statistics
import time

from rover.core.mcu import FLAG_IMU_OK
from rover.tools import calibrate as cal
from rover.tools.floor_test import board_temp_c

STAGES = ("S3", "S6")
REST_S = 300
SETUP = ("Needs: the rover on the venue floor, square to a wall or a big flat box 1.0-2.0 m straight ahead, 50 cm clear all\n"
         "round, a charged pack, a cool motor driver. It finds the power to start a drive (towards the target, never closer\n"
         "than 80 cm) and to turn, rests 5 min for the motor driver, then makes 18 turns: about 9 min. Add --go to start.")


def ready(x):
    """A light check before anything moves: the firmware, the gyro still, the battery at rest, the board's heat, and a
    target S3 and S4 can drive towards. No sonar spread rule: at 1-2 m single pings wander ~70 mm on a flat wall."""
    info = x.mcu.info()
    if "brake_k=" not in info:
        return ["the firmware is older than the suite: flash it (rover/tools/deploy.sh --flash)"], {"info": info}
    x.push()
    x.calibrate_imu()
    still = x.s.pump(2.0)
    a, b = still[0], still[-1]
    x.resets = b["imu_resets"]
    drift = abs(b["yaw_cdeg"] - a["yaw_cdeg"]) / 100 / max((b["ms"] - a["ms"]) / 1000, 1e-3)
    batt = statistics.median(st["batt_now_mv"] for st in still)
    target = x.sonar()
    temp = board_temp_c()
    summary = {"batt_mv": batt, "gyro_drift_dps": round(drift, 3), "target_mm": target, "board_c": temp}
    problems = []
    if batt < cal.BATT_STOP_MV:
        problems.append(f"battery {batt / 1000:.2f} V: charge it")
    if drift > 0.5 or not b["flags"] & FLAG_IMU_OK or b["imu_resets"] != a["imu_resets"]:
        problems.append("the gyro is not steady: keep the rover still and check the gyro's wires")
    if target is None or not cal.TARGET_MIN_MM <= target <= cal.TARGET_MAX_MM:
        problems.append(f"put a wall or a big flat box 1.0-2.0 m straight ahead (the sonar reads {target} mm)")
    if temp is not None and temp > cal.BOARD_STOP_C:
        problems.append(f"the board is at {temp:.0f} C")
    return problems, summary


def rest(x, seconds):
    """The motor driver cools while the rover stands still; a line a minute so the operator knows it is waiting."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        left = end - time.monotonic()
        print(f"--- resting for the motor driver: {left / 60:.0f} min left", flush=True)
        x.s.pump(min(60.0, left))


def stages(x, rest_s):
    """S3, a rest, S6; each applied as it passes. A failed S3 stops the run."""
    results = {}
    for name in STAGES:
        if name == "S6" and rest_s > 0:
            rest(x, rest_s)
        results.update(cal.run_stages(x, [name], apply=True))
        if name == "S3" and not results["S3"]["pass"]:
            break
    return results


def main():
    p = argparse.ArgumentParser(description="the venue's floor calibration: S3 and S6 only")
    p.add_argument("--go", action="store_true", help="the operator has set up the rover and says go")
    p.add_argument("--place", default="venue")
    p.add_argument("--rest-s", type=int, default=REST_S, help="seconds the motor driver rests before S6")
    a = p.parse_args()
    if not a.go:
        print(SETUP)
        return 0

    def body(x):
        print("--- ready: firmware, gyro, battery, board, target", flush=True)
        problems, summary = ready(x)
        x.log("ready", {"verdict": "fail" if problems else "pass", "problems": problems, "summary": summary})
        if problems:
            print(f"\nFAIL before moving: {'; '.join(problems)}", flush=True)
            return 1
        results = stages(x, a.rest_s)
        ok = len(results) == len(STAGES) and all(r["pass"] for r in results.values())
        if not ok:
            cal.write(x, results, False, applied=x.applied)  # the failed stages' numbers, for the record only
        cal.print_changes(x)
        failed = [n for n, r in results.items() if not r["pass"]]
        print(f"\n{'PASS' if ok else 'FAIL'}: applied {', '.join(x.applied) or 'nothing'}"
              + (f"; failed {', '.join(failed)}" if failed else "") + f"; evidence in {x.out}", flush=True)
        return 0 if ok else 1

    return cal.with_rover(a.place, "floor", body)


if __name__ == "__main__":
    raise SystemExit(main())


# venue_cal: floor calibration routine for a new venue.
# Runs S3 (grip/turn power), a 5min cool-down rest, then S6 (turn accuracy).
# Drives are measured by encoders (S4 is skipped if the driver overshot).
# Writes calibration.json immediately after each passing stage.
# Used on the morning of 7 Nov before the first ETHGlobal run.
VENUE_REST_MINUTES = 5
