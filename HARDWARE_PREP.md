# Hardware: the rover, how it was built, and how to prepare it

This is the story of the robot itself: what it is made of, how it was
put together, what went wrong along the way, and what to pack and check
before a demo. All the numbers come from real floor tests, written up in
[prior-work/evidence](prior-work/evidence).

## Meet the rover

The rover, "RoverA", is a small four-wheeled car about the size of a
shoebox. On top sits an **Arduino UNO Q**, a board with two brains in
one: - a Linux computer that runs the camera, talks to 0G and Hedera
over Wi-Fi, and makes the decisions; - a small microcontroller that
drives the motors and reads the sensors many times a second.

The two halves talk all the time. If the Linux side goes quiet for 300
ms, the microcontroller stops the wheels by itself. That is the rover's
most important safety habit.

It sees with a USB webcam, measures distance with an ultrasonic sonar at
the front, and knows which way it is facing from a gyro (IMU). A small
LED screen on the board shows a "face" that tells you what it is doing:
thinking, moving, waiting for payment, stopped, or done.

## What it is made of

  -----------------------------------------------------------------------
  Part                    What we used            Why it is there
  ----------------------- ----------------------- -----------------------
  Brain board             Arduino UNO Q, 4 GB     Linux for the mission,
                                                  a microcontroller for
                                                  the motors

  Chassis                 4WD double-layer kit,   The body
                          255 × 150 mm, four TT   
                          gear motors (1:48), 65  
                          mm wheels               

  Motor driver            L298N, 2 A              Turns the board's
                                                  signals into motor
                                                  power

  Motor battery           2S Li-ion pack, 7.4 V,  Powers the motors only
                          2500 mAh, with          
                          protection board        

  Charger                 2S Li-ion, 8.4 V, 2 A   Charges the motor pack.
                                                  **Never use a 9 V or 12
                                                  V adapter**

  Sonar                   HC-SR04                 Measures the distance
                                                  to what is in front

  Gyro                    MPU-6050                Keeps track of the
                                                  heading while the rover
                                                  turns

  Camera                  Logitech C310 webcam    What 0G sees. Its view
                                                  is 43° wide

  Board power             Ambrane 20000 mAh power Powers the UNO Q and
                          bank and a USB-C hub    the camera
                          with power-in           

  Safety                  6 A rocker switch (the  Cuts motor power at
                          kill switch) and a 5 A  once
                          fuse                    

  Small parts             470 µF capacitor across Quiet power and a cool
                          the motor supply, a 100 board
                          nF capacitor on each    
                          motor, 1 kΩ resistors   
                          for two voltage         
                          dividers, a small       
                          heatsink on the UNO Q's 
                          chip                    

  Tyre tape               PVC electrical tape     Lets the rear wheels
                          (Pidilite Steelgrip+)   slide, so the rover can
                          on the two **rear**     spin on the spot.
                          tyres for the event;    Before the rear tyres
                          adhesive PTFE (Teflon)  were taped, they were
                          tape is the plan for    **stock rubber**: the
                          the event               plan called for taping
                                                  them, but this had not
                                                  yet been done. In the
                                                  simulator, bare tyres
                                                  turned only 20° in 6
                                                  seconds
  -----------------------------------------------------------------------

Two wheel encoders were on the parts list but never arrived, so the
rover has none yet. It measures distance by time and checks it with the
sonar. Pavan plans to mount encoders before the event, so the rover can
calibrate itself (see "Still to do" at the end).

## How the power flows

There are two separate power systems, and they never mix:

1.  **The board:** power bank → USB-C hub → UNO Q. The webcam plugs into
    the hub too.
2.  **The motors:** 2S pack → fuse → kill switch → L298N motor driver.

The UNO Q is **never** powered from the motor battery. The two systems
share only a ground wire, which the motor signals need.

The board also watches the motor battery through a divider of three 1 kΩ
resistors (the voltage divided by 3, into pin A0). When the pack drops
below 7.0 V, the microcontroller refuses to drive and shows `BAT`.

## Where the wires go

The full plan, all 51 connections hole by hole, is in
[docs/rover/HANDOFF.md](docs/rover/HANDOFF.md) §2.1. The short version:

-   **Motors:** speed on D5 (left) and D6 (right), direction on D7, D8,
    D12 and D13. The two left motors share one output, and so do the two
    right ones. Take the ENA/ENB jumpers off the L298N. The left pair's
    wires were swapped so that "forward" means forward on both sides.
-   **Sonar:** 5 V power, trigger on A2, echo through a 1k/2k divider
    into A3 (so the 5 V echo arrives at about 3.3 V).
-   **Gyro:** 3.3 V power and the I2C pins (SCL/SDA). It must sit flat.
    Its power goes from the UNO Q through a breadboard, and a loose
    contact at that connection made the gyro reset repeatedly (see
    below). Press it in firmly, or better, solder it.
-   **Battery sense:** the divider into A0.
-   **Ground:** the L298N ground and the UNO Q ground are joined. This
    is required.

## Teaching it to move

A cheap car doesn't drive straight or turn exactly by itself, so we
measured it on the floor and wrote the results into
`rover/core/calibration.json` and the firmware:

-   **Cruise:** 38 % power. From a standstill it needs a short kick (70
    % for 200 ms; 100 ms left some drives straining in place) to start
    rolling. On the original bare-rubber setup, that was about 28 cm per
    second. With the rear tyres taped, the rover rolls more easily:
    measured against a wall with the sonar, it is now **32.4 cm per
    second**.
-   **Turns:** 85 % power, but every turn now **starts at 100 % for 200
    ms** to break the tyres free. The rover keeps turning a little after
    it brakes, so it brakes early, by a rule fitted to real turns. In
    calibration tests, turns of 15° to 90° in both directions all ended
    within 0.2° to 1.6° of the target. With the tyres taped, ten 30°
    turns missed by 0.2° on average, and six 90° turns landed between
    85.2° and 90.2°.
-   **Stall guard:** if a turn is still slower than 10° a second 0.4 s
    after that first push, the motor board stops it and reports "stall".
    The rover no longer hums in place.
-   **Sonar:** its reading is corrected by 18 mm, measured against a
    tape. At the rover's cruise speed it brakes when something is within
    about 23 cm (12 cm plus 0.4 seconds of travel). In the wall test it
    stopped 15 cm short.
-   **Battery reading:** first read 3.8 % low, so the scale was
    corrected. It now matches the charger's 8.4 V to within 0.3 %. A
    full pack rests at about 8.3 V.
-   **Endurance:** with a full pack, 157 turns in a row over 5 minutes,
    with no stall, no gyro reset and the battery never below 7.74 V. The
    board stayed under 42 °C with its heatsink.
-   **Camera:** exposure, gain and white balance are fixed (30 ms, gain
    96, 2900 K), so the picture doesn't change while the rover turns.
    Lighting at a new place is different, so re-measure them there (see
    the checklist).

## What broke, and what we learned

Every one of these really happened, and each one changed the rover:

-   **A loose motor wire** stopped the wheels and pulled the battery
    down to 2.2 V. We tightened every screw terminal, and we check them
    before every session now.
-   **The gyro fell asleep** when its wires were touched: it kept
    reporting zeros, with no error. The firmware now checks the gyro
    every half second. If it has reset, it stops, sets it up again and
    asks for a new calibration.
-   **Full-power turns made the gyro reset**, because of a loose
    capacitor and wires running too close to the motors. Pavan re-did
    the wiring.
-   **The motor battery read 0 V** because of a loose contact, so every
    move was refused. The rover now refuses to *start* a mission when it
    can't see the motor battery, before any money is spent.
-   **Someone turned the rover by hand while the gyro was calibrating,**
    so its idea of "still" was badly wrong, and it took three photos of
    the same side. Now a mission starts only if the gyro reads steady
    (bias under 5° per second, drift under 0.5° per second).
-   **The power bank ran flat** on, and the rover simply dropped off the
    Wi-Fi. The rover can't see the power bank's charge, so charge it
    fully before each session. We still have to measure how long a full
    power bank lasts.
-   **A wall stopped a back-up move.** The sonar only looks forward, so
    backing up is blind. The rover backs up 20 cm at most, and only just
    after it has driven in towards the box (at most a turn on the spot
    in between).
-   **The sonar misses soft and slanted things,** such as a bag or a box
    corner. The AI's view of the camera is the second pair of eyes.
-   **The camera swivels on its clip** when the rover is picked up.
    Straighten it before each run.

### Floor-test findings

It had just rained, and that evening taught us more about the rover than
any other.

-   **The motors hummed, and the rover didn't turn.** In one mission
    before the event, 4 of 13 turns pushed at 85 % for the full 12
    seconds and moved less than 6°. You could hear the motors straining.
    With the wheels in the air, all four turned fine. On the floor, the
    same 85 % that had previously turned at 154° a second only reached
    81--106°. The tiles were damp after the rain, and the bare rubber
    gripped too hard to slide round. We made three changes:
-   every turn now starts with a 100 % push;
-   a stall guard stops a stuck turn in about half a second;
-   Pavan taped the two rear tyres.

With the tape on, 85 % turned at 151° a second again. - **The gyro kept
resetting while the rover stood still.** It reset 42 times, then 71,
with 197 failed reads. Each time the motor board stopped the move at
once, which is what it should do. Pavan traced it to the power wire that
runs from the UNO Q through the breadboard to the gyro, and fixed it.
Afterwards: 0 resets. The mission start is now stricter too. It tries
the gyro calibration up to three times. A reset during the check counts
as a failure (a reset gyro reads zero, which used to look "perfectly
still"). And the event check now counts the gyro's resets since boot. -
**The camera vanished.** After a restart, the UNO Q's USB-C port came up
as a *device* instead of a *host*, so it couldn't see the hub or the
webcam. Unplugging the hub and plugging it back in fixed it. If the
camera is ever missing, try that first. - **The front-left wheel is
weak.** Taping the rear tyres moved nearly all the grip to the front
wheels. Then a weak front motor really shows. In another mission before
the event (3 of 5 photos before the time ran out), every forward drive
pulled left by 1.3--3.9° per 32 cm, and 11 left turns stalled. In the
wheels-up check (`rover/tools/wheels_check.py`), the left side drew
about 30 % less current at 85 %, and The front-left wheel was observed
turning with less power. Less power *and* less current means a bad
connection, not a stiff gearbox. Next step: solder its wires, at the
motor and at the L298N, and check again. If it is still weak, replace
the motor.

## Packing for the event

**Bring:** - the rover, the 2S charger (8.4 V, 2 A only), the power bank
(full) and a USB-C 3 A cable; - spare 5 A fuses, adhesive PTFE tape (and
the PVC tape as a backup), a spare TT gear motor, a soldering iron, zip
ties, Velcro for the gyro, and a tape measure; - the parcels, with the
number printed on **every** face: #1, #2, #3, and a blank decoy. The
rover only takes a photo when it can read the number in that photo, so a
face without a number can't be photographed; - the phone hotspot (5 GHz)
and an extension board.

**Before the first run:** 1. Charge the motor pack to about 8.3 V, and
the power bank to full. 2. Check every screw terminal, the front motor
wires, the gyro's power wire, that the gyro sits flat, that the rear
tyre tape is smooth, and that the camera faces straight ahead. 3. On the
laptop, run `node scripts/event-check.mjs`. It checks 0G, Hedera, the
laptop services and the rover, including how often the gyro has reset
since boot, and tells you what to fix. 4. With the wheels in the air,
run the wheel check (`venv/bin/python -m rover.tools.wheels_check` on
the board, with the service stopped). All four wheels should turn, and
both sides should draw about the same current. 5. On the venue floor,
run a quick turn test
(`venv/bin/python -m rover.tools.floor_test turns --deg 30 --reps 5`).
Every turn should finish with no stall. A new floor grips differently.
6. Re-measure the camera under the venue lights. On the board, stop the
service (`sudo systemctl stop rover.service`), run
`cd ~/0xbs-rover && venv/bin/python -m rover.tools.camera_cal exposure`,
then start the service again. 7. Do one short mission and watch it on
the HUD.

**Between runs:** - charge the motor pack when it reads under 7.6 V; -
let the board cool if the event check says it is hot.

**Still to measure (plan phase P10):** how many missions one charge
gives, and how long the power bank lasts with the full service running.

**Still to do:** - Solder the front-left motor. - Mount the wheel
encoders. - Build the self-calibration suite (plan phase 10A). It's one
command that measures grip, speed, turns and braking on any floor, using
the rover's own gyro, sonar and encoders. A floor change is then caught
and fixed in minutes.
