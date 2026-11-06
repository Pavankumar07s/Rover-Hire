#pragma once
#include <Arduino.h>

namespace pin {
constexpr int ENA = 5;  // PWM; never pinMode() D5/D6 on this core, it breaks analogWrite
constexpr int ENB = 6;
constexpr int IN1 = 7;
constexpr int IN2 = 8;
constexpr int IN3 = 12;
constexpr int IN4 = 13;
constexpr int ENC_L = 2;
constexpr int ENC_R = 4;
constexpr int SONAR_TRIG = A2;
constexpr int SONAR_ECHO = A3;
constexpr int BATT = A0;
}

constexpr uint32_t CONTROL_PERIOD_MS = 10;
constexpr uint32_t LEASE_MAX_MS = 1500;
constexpr uint32_t HEARTBEAT_TIMEOUT_MS = 300;
constexpr uint32_t PING_PERIOD_MS = 60;
constexpr uint32_t ECHO_TIMEOUT_US = 30000;
constexpr uint32_t SONAR_STALE_MS = 300;
// Defaults below that set_cal3 can change per floor (Phase 10A suite).
constexpr int32_t DEFAULT_SONAR_OFFSET_MM = -18;  // P1 sonar test: +8.4 mm mean error at 15-40 cm with -10
constexpr int32_t DEFAULT_REFLEX_BASE_MM = 120;   // brake at 12 cm + v * 0.4 s
constexpr int32_t REFLEX_V_UNCAL_MM_S = 700;
// Rotation after halt, measured once still (P1 re-fit, 8 turns 15-90 deg, rms 1.1 deg):
// stop_deg = 0.055 s x rate + rate^2 / 3704, i.e. in cdeg: rate_cdps x 55 / 1000 + rate_cdps^2 / 370370.
constexpr int32_t DEFAULT_TURN_BRAKE_K_X1000 = 55;
constexpr int32_t DEFAULT_TURN_BRAKE_Q_DIV = 370370;
// Turns from rest (P10, 0.8 s spins on the floor): 85 % turned 35-68 deg, 100 % 125-143 deg. Starting at the 70 %
// drive kick left 4 of 13 turns humming in place for 12 s (a live run), so a turn starts at full power, and one that is
// still under 10 deg/s 0.4 s after that stops as a stall. Defaults: set_cal2 sets them per floor (dry tiles and
// bare rubber: 30 deg turns end inside the 100 % kick and overshoot ~5 deg).
constexpr int DEFAULT_TURN_KICK_PCT = 100;
constexpr int32_t DEFAULT_STALL_CDPS = 1000;
constexpr uint32_t DEFAULT_STALL_MS = 400;
// Without encoders a drive's distance is time x cruise speed, but the rover needs a moment to reach that speed, so short
// drives came out short (orbit legs). set_cal2 sets how long that start-up takes; 0 counts from the first moment.
constexpr uint32_t DEFAULT_DRIVE_LAG_MS = 0;
constexpr uint32_t DEFAULT_ROLL_MS = 0;    // encoder drives stop early by speed x this (~0.2 s of roll after the stop)
constexpr uint32_t SPEED_WINDOW_MS = 100;  // encoder speed is measured over this long
constexpr uint32_t IMU_RETRY_MS = 2000;  // a gyro missing at boot is looked for again this often (loose wire)
constexpr int32_t DEFAULT_CUTOFF_MV = 7000;  // the L298N's 78M05 needs >= 7 V in
constexpr uint32_t DEFAULT_BRAKE_MS = 100;
constexpr uint32_t ENC_MIN_GAP_US = 300;
constexpr uint32_t BATT_SAMPLE_MS = 50;
// ADC full scale for the 3 x 1k divider: nominal 9900 mV, measured 10290 against the charger's 8.4 V (P1).
constexpr int32_t BATT_FULL_SCALE_MV = 10290;

enum Mode : int { MODE_IDLE = 0, MODE_DUTY = 1, MODE_DRIVE = 2, MODE_TURN = 3, MODE_BRAKE = 4 };

enum StopReason : int {
  STOP_NONE = 0,
  STOP_CMD = 1,
  STOP_LEASE = 2,
  STOP_HEARTBEAT = 3,
  STOP_REFLEX = 4,
  STOP_BATTERY = 5,
  STOP_DONE = 6,
  STOP_IMU = 7,
  STOP_SONAR = 8,  // drive_until reached its sonar distance
  STOP_STALL = 9,  // a turn that never got going: the wheels strain in place
};

enum Refusal : int {
  REF_OK = 0,
  REF_NO_HEARTBEAT = 10,
  REF_NO_IMU = 11,
  REF_NO_CAL = 12,
  REF_LOW_BATTERY = 13,
  REF_BAD_ARG = 14,
  REF_NOT_MOVING = 20,
};

enum Face : int {
  FACE_IDLE = 0,
  FACE_READY = 1,
  FACE_THINKING = 2,
  FACE_MOVING = 3,
  FACE_ZG = 10,
  FACE_TEE = 11,
  FACE_PAY = 12,
  FACE_STOP = 13,
  FACE_DONE = 14,
  FACE_BATTERY = 15,
};
// 2026-11-06T00:12:00
// 2026-11-06T21:38:00


// set_cal2 runtime calibration (P10A): turn brake rule K/Q, stall guard,
// per-side trim, drive start-up lag, sonar offset.
// set_cal3: turn kick %, reflex base mm, sonar offset.
// These are set by calibrate.py and venue_cal.py — no reflash needed.
extern int16_t TURN_BRAKE_K_X1000;  // K * 1000, default 55
extern int32_t TURN_BRAKE_Q_DIV;    // Q divisor, default 3704
extern int16_t STALL_CDPS;          // stall threshold centideg/s, default 1000
extern uint16_t STALL_MS;           // stall window ms, default 400
extern int16_t SIDE_TRIM_L;         // left side trim %, default 0
extern int16_t SIDE_TRIM_R;         // right side trim %, default 0
