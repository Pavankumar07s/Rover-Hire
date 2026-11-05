# Calibrating the rover

The rover's moves depend on the floor. The same turn power that spins it on dry tiles can leave it humming in place on a damp or grippy floor, and a smooth floor lets it roll further after a stop. One tool, `rover/tools/calibrate.py`, measures all of this with the rover's own sensors (the gyro, the sonar, the wheel encoders, the battery reading and the camera). It then writes the numbers the rover drives with.

## How to start it

On the rover's board, from the folder the rover runs from:

```
ssh arduino@rovera.local
cd ~/0xbs-rover          # until Phase 10A is merged: cd ~/0xbs-rover-p10a
venv/bin/python -m rover.tools.calibrate <command> [options]
```

## At the venue: one command

```
venv/bin/python -m rover.tools.venue_cal --go --place venue
```

The rover square to a wall or a big flat box 1.0–2.0 m ahead, 50 cm clear all round, a cool motor driver. About 9 minutes:

1. **A light check** (no motion): firmware, gyro still, battery at rest, board temperature, the target 1.0–2.0 m ahead.
2. **S3 floor grip:** the power that starts a drive on this floor, and the turn power (below). Saved as soon as it passes.
3. **A 5-minute rest,** so the motor driver cools. On 4 Nov the L298N faded twice after about 30 turns in a row.
4. **S6 turns:** how far a turn coasts on this floor, and so where to brake. Saved as soon as it passes.

A failed S3 stops it (S6 turns at S3's power). Drives are not measured again: the wheel encoders measure their length,
and on 3 Nov a tape showed 30.0, 40.3 and 50.0 cm. Run `check` first if you like (below): it takes under a minute.

## The four commands of the full tool

| Command | Rover where | Time | What it does | Writes |
|---|---|---|---|---|
| `run` | On the floor, facing a wall or a big box 1.0–2.0 m ahead, 50 cm clear all round | About 6 min | The full calibration: stages S0 to S7 (below) | `calibration.json` (and the camera's field of view in `camera.json`) |
| `check` | Same setup as `run` | Under 1 min | A quick health check: S0 and S1, then turns of 30°, −30°, 90° and −90° (each must land within 3°) and one 30 cm drive (must land within 3 cm) | Nothing |
| `wheels` | **Lifted**, all four wheels in the air | About 30 s | Each side alone at 38, 75 and 100 % for 2 s: wheel speed from the encoder and the battery dip. Names a dead encoder or side, and a side more than 10 % slower than the other (less current: a bad contact; more current: a stiff gearbox) | Nothing |
| `orbit` | On the floor, a **round bucket** (25–30 cm across) 45 cm ahead, about 1.6 m clear all round it | About 6 min | Stage S6b: drives the mission's own orbit legs round the bucket at two pivot values, finds the one that keeps the gap flat, and checks it with 5 more legs | `pivot_behind_front_mm` only |

### `run` and `check`: the difference

- **`run` changes the rover.** It measures, works out new values, and writes them to `calibration.json`.
- **`check` changes nothing.** It answers one question: "do the current values still work here?" Use it between missions, after carrying the rover, and first thing at the venue.
- If `check` fails, run the stages that cover the problem: turns that miss or stall need S3 and S6; a 30 cm drive that's off needs S4.

## The options

| Option | For | What it means |
|---|---|---|
| `--go` | All commands | **Nothing moves without it.** Without `--go` the tool only prints the setup it needs (the space, the target, the battery), so you can read it before the rover moves. With `--go` you are saying: "the rover is set up and the space is clear". This is the plan's safety rule: one "go" from the operator, at the start. |
| `--place NAME` | All commands | A label, such as `home` or `venue`. It names the evidence folder and goes into the calibration file, and `scripts/event-check.mjs` shows it with the date. |
| `--stages S0,S3,S6` | `run` | Runs only these stages, in this order. On its own, a subset writes only `calibration.candidate.json`, because the later stages use the values the earlier ones found in the same run. |
| `--apply` | `run` | Writes each stage's values to `calibration.json` **as soon as that stage passes**, then runs the next stage on them. A failed stage stops the run. The stages that passed before it stay applied, and the failed stage's numbers go to the candidate file, for the record only. |

## The stages of `run`

| Stage | What the rover does | Passes when | Sets |
|---|---|---|---|
| S0 Preflight | Stands still: calibrates the gyro and sends 60 sonar pings | Firmware new enough; gyro steady; encoders still; battery ≥ 7.4 V; sonar steady with the target 1.0–2.0 m ahead; camera present; board ≤ 75 °C | Nothing |
| S1 Wiring | Short pulses: left side, right side, both, spin left, spin right | Every side moves the right way and each encoder counts its own side | Nothing |
| S2 Power | Spins at 30, 60 and 100 % | The battery drops ≤ 0.8 V at full power and stays ≥ 7.3 V | The power baseline |
| S3 Floor grip | Raises the power until it starts driving; lowers it until the drive stops rolling (it stops 80 cm from the target). Then real 45° turns left and right, the way missions turn (a 100 % kick, then the turn power), at 55, 65, 75, 85 and 100 % until both finish | A drive starts before 100 % and the body really moves; turns finish at some power (a warning if they need 85 % or more: a grippy floor) | The start push, the slowest drive power, the cruise power, and the turn power: the first power where both turns finished, + 15 % |
| S4 Straight drive | Three timed drives toward the target, three 30 cm drives, one 20 cm back-off; the sonar measures each true distance | The drives agree on the distance per encoder edge (5 %), drift ≤ 3° per 50 cm, 30 cm lands within 3 cm, back-off within 3 cm. 30 cm drives more than 6 cm off are not fitted: that is a hot motor driver braking weakly (4 Nov: 43.8 cm) | Distance per encoder edge, cruise speed, heading correction, side trim, the roll after a stop |
| S5 Braking | Four "drive until the sonar reads X" stops, then one planned reflex stop | The sonar ends each stop; the reflex stops ≥ 12 cm from the target | How far `approach` overshoots its sonar stop |
| S6 Turns | 12 turns of 15–180° with 4 s rests, then 6 random turns | At most 2 stalls; all 6 random turns within 3° | The brake rule for turns. On 4 Nov it moved from K 55 / Q 370370 to K 44 / Q 659520: turns that landed 1–5° short then landed within 1.6° |
| S7 Camera | Checks the light, then 4 turns of 10° with a photo before and after each | The 4 turns agree on the field of view within 1.5° | The field of view, only when it is more than 1.5° away from the stored 43.1° |

## Safety: when it stops by itself

The tool stops at once if any of these happens:
- the gyro resets;
- the reflex stops the rover when that wasn't planned;
- the battery is under 7.4 V at rest (it says "charge it"), or a battery stop happens while the pack is fine (it names the loose sense wire);
- the board is over 75 °C;
- a full-speed turn (45° or more) in S6's measuring turns runs under 60 % of the speed of the first ones: the motor driver is hot (it says "let it cool 15 min");
- a move doesn't end by itself.

It also stops on Ctrl-C. A stopped run writes nothing more; with `--apply`, the stages that passed before the stop stay applied, and it says which.

Before it starts, the tool stops `rover.service`, because both need the motor board. When it ends, it puts the service's values back on the motor board and starts the service again. The service sends `calibration.json` to the motor board when it starts, so new values are live straight away.

## What it leaves behind

- **Evidence:** `evidence/CAL/<date>-<place>/` (`-check`, `-wheels` or `-orbit` is added for those commands). It holds one log per stage, `summary.md` with each value's old number, new number and the reason, and a backup of the calibration file from before the first write.
- **The answer:** it ends with `PASS` or `FAIL`. The exit code is 0 for a pass, 1 for a fail and 2 for a stop.

## Recipes

**At home, the first time (stage by stage, keeping each one that passes):**
```
venv/bin/python -m rover.tools.calibrate run --stages S0,S1 --apply --place home --go
venv/bin/python -m rover.tools.calibrate run --stages S2 --apply --place home --go
...                                            # S3, S4, S5, S6 (let the motor driver cool first), S7
venv/bin/python -m rover.tools.calibrate orbit --place home --go      # with the bucket, motor driver cool
```

**At the venue (the floor changes the grip and how far a turn coasts; everything else belongs to the rover):**
```
venv/bin/python -m rover.tools.calibrate check --place venue --go      # optional, under 1 min
venv/bin/python -m rover.tools.venue_cal --go --place venue             # S3, rest, S6: about 9 min
```

**Between missions:** `check --go`.

**After any rewiring:** `wheels --go` with the rover lifted. Then look at the wheels too, because the encoders can't tell forward from backward.

## The calibration file belongs to the rover

The tool writes `rover/core/calibration.json` on the rover's board. `rover/tools/deploy.sh` keeps that file (and
`camera.json`) when it copies new code to the board, so a deploy never undoes a calibration. To send the repo's copies
instead, add `--with-calibration`. (On 4 Nov a deploy did wipe a fresh S3 result, before this rule; it was put back
from the evidence log.)
