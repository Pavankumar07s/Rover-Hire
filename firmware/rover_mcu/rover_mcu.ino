// UNO Q MCU for the 0xBs rover: motors, IMU, sonar, encoders, faces, leases and stop-only reflexes.
#include <Arduino_RouterBridge.h>
#include "batt.h"
#include "config.h"
#include "enc.h"
#include "faces.h"
#include "imu.h"
#include "motors.h"
#include "sonar.h"

static const char BUILD[] = __DATE__ " " __TIME__;

struct Cal {
  int cruisePct, cruiseMmS, battMv, kickPct, kickMs, floorPct, turnPct, kpX10, brakeMs, mmPerEdgeX100;
  bool set;
};
static Cal cal = {0, 0, 0, 0, 0, 0, 0, 0, (int)DEFAULT_BRAKE_MS, 0, false};

static volatile uint32_t hbMs = 0;  // written by the bridge thread
static int mode = MODE_IDLE;
static int stopReason = STOP_NONE;
static int lastRefusal = REF_OK;
static uint32_t startMs = 0, haltMs = 0, leaseUntil = 0, brakeUntil = 0, kickUntil = 0, nextTick = 0, turningAt = 0, imuRetryAt = 0;
static int dutyL = 0, dutyR = 0;
static int dir = 0, speedPct = 0;
static int turnKickPct = DEFAULT_TURN_KICK_PCT;
static int32_t stallCdps = DEFAULT_STALL_CDPS;
static uint32_t stallMs = DEFAULT_STALL_MS;
static uint32_t driveLagMs = DEFAULT_DRIVE_LAG_MS;
static uint32_t rollMs = DEFAULT_ROLL_MS;
static int32_t brakeKx1000 = DEFAULT_TURN_BRAKE_K_X1000;
static int32_t brakeQdiv = DEFAULT_TURN_BRAKE_Q_DIV;
static int32_t reflexBaseMm = DEFAULT_REFLEX_BASE_MM;
static int32_t sonarOffsetMm = DEFAULT_SONAR_OFFSET_MM;
static int trimPct = 0;  // > 0 adds to the left side's drive power, < 0 to the right's
static int haltMode = MODE_IDLE;
static int32_t haltRateCdps = 0, haltYawCdeg = 0;
static uint32_t encL = 0, encR = 0, movedL = 0, movedR = 0, speedAt = 0, speedEdges = 0;
static int32_t speedMmS = 0;
static int32_t targetMm = 0, distMm = 0, yaw0 = 0, turnTarget = 0;
static uint32_t durationMs = 0;
static int32_t sonarStopMm = 0;
static int32_t cutoffMv = DEFAULT_CUTOFF_MV;
static int imuWho = -1;

static uint32_t battAtMs = 0;

static int32_t readBattMv() {
  long sum = 0;
  for (int i = 0; i < 4; i++) sum += analogRead(pin::BATT);
  return (int32_t)(sum * BATT_FULL_SCALE_MV / (4 * 1023));
}

static void battStep(uint32_t now) {
  if (now - battAtMs < BATT_SAMPLE_MS) return;
  battAtMs = now;
  battSample(now, readBattMv());
}

static bool active() { return mode == MODE_DUTY || mode == MODE_DRIVE || mode == MODE_TURN; }

// Signed age: the bridge thread may stamp hbMs after `now` was read.
static bool heartbeatFresh(uint32_t now) {
  uint32_t h = hbMs;
  return h != 0 && (int32_t)(now - h) <= (int32_t)HEARTBEAT_TIMEOUT_MS;
}

static int refuse(int code) {
  lastRefusal = code;
  if (code == REF_LOW_BATTERY) facesShow(FACE_BATTERY);
  return code;
}

static int checkCommon(uint32_t now) {
  if (!heartbeatFresh(now)) return REF_NO_HEARTBEAT;
  if (battLevelMv() < cutoffMv) return REF_LOW_BATTERY;
  return REF_OK;
}

static int checkMotion(uint32_t now) {
  int c = checkCommon(now);
  if (c) return c;
  if (!imuOk()) return REF_NO_IMU;
  if (!cal.set) return REF_NO_CAL;
  return REF_OK;
}

// Holds the voltage at the motors near what it was during calibration.
static int compensate(int pct) {
  if (cal.battMv > 0 && battLevelMv() > 0) pct = (int)((long)pct * cal.battMv / battLevelMv());
  return constrain(pct, cal.floorPct, 100);
}

static int shaped(int pct, int sign) { return sign * constrain(pct * sign, cal.floorPct, 100); }

static void halt(int reason, uint32_t now) {
  motorsBrake();
  haltMode = mode;
  haltRateCdps = imuRateCdps();
  haltYawCdeg = imuYawCdeg();
  mode = MODE_BRAKE;
  brakeUntil = now + (uint32_t)cal.brakeMs;
  stopReason = reason;
  haltMs = now;
  if (reason == STOP_REFLEX || reason == STOP_STALL) facesShow(FACE_STOP);
  if (reason == STOP_BATTERY) facesShow(FACE_BATTERY);
}

static void beginMotion(int newMode, int leaseMs, uint32_t now) {
  bool fromRest = !active();
  mode = newMode;
  startMs = now;
  battMarkMin();
  leaseUntil = now + min((uint32_t)leaseMs, LEASE_MAX_MS);
  kickUntil = fromRest ? now + (uint32_t)cal.kickMs : now;
  stopReason = STOP_NONE;
  lastRefusal = REF_OK;
}

static bool movingForward() {
  if (mode == MODE_DUTY) return dutyL > 0 && dutyR > 0;
  return mode == MODE_DRIVE && dir > 0;
}

static int32_t reflexMm() {
  int32_t v = REFLEX_V_UNCAL_MM_S;
  if (cal.set && cal.cruiseMmS > 0 && cal.cruisePct > 0) {
    int pct = mode == MODE_DUTY ? min(dutyL, dutyR) : speedPct;
    v = (int32_t)((long)cal.cruiseMmS * pct / cal.cruisePct);
  }
  return reflexBaseMm + v * 4 / 10;
}

static void driveStep(uint32_t now) {
  // a command can start a motion after the loop read `now`: a negative gap wrapped to ~49 days and ended a
  // back-off at once with dist 2040109446 mm (a live run, seq 10)
  uint32_t elapsed = (int32_t)(now - startMs) > 0 ? now - startMs : 0;
  int32_t leadMm = 0;
  if (cal.mmPerEdgeX100 > 0) {
    uint32_t l, r;
    encRead(l, r);
    uint32_t edges = (l + r) / 2;
    distMm = (int32_t)(edges * (uint32_t)cal.mmPerEdgeX100 / 100);
    if (l != encL) { encL = l; movedL = now; }
    if (r != encR) { encR = r; movedR = now; }
    // each side on its own: one dead encoder would otherwise halve the count and double the drive
    if ((int32_t)(now - kickUntil) >= 0 &&
        ((int32_t)(now - movedL) >= (int32_t)stallMs || (int32_t)(now - movedR) >= (int32_t)stallMs))
      return halt(STOP_STALL, now);
    if (now - speedAt >= SPEED_WINDOW_MS) {
      speedMmS = (int32_t)((edges - speedEdges) * (uint32_t)cal.mmPerEdgeX100 * 10 / (now - speedAt));
      speedAt = now;
      speedEdges = edges;
    }
    leadMm = speedMmS * (int32_t)rollMs / 1000;
  } else if (cal.cruiseMmS > 0) {
    uint32_t cruising = elapsed > driveLagMs ? elapsed - driveLagMs : 0;
    distMm = (int32_t)((uint64_t)cruising * cal.cruiseMmS / 1000);
  }
  if (sonarStopMm > 0) {
    int32_t s = sonarMm(now);
    if (s >= 0 && s <= sonarStopMm) return halt(STOP_SONAR, now);
  }
  if (targetMm > 0 && distMm + leadMm >= targetMm) return halt(STOP_DONE, now);
  if (durationMs > 0 && elapsed >= durationMs) return halt(STOP_DONE, now);
  if ((int32_t)(now - kickUntil) < 0) {
    motorsSet(dir * cal.kickPct, dir * cal.kickPct);
    return;
  }
  int d = compensate(speedPct);
  int corr = (int)((long)(yaw0 - imuYawCdeg()) * cal.kpX10 / 1000);  // kp in %/deg x10, yaw in cdeg
  int dl = d + max(trimPct, 0), dr = d + max(-trimPct, 0);
  motorsSet(shaped(dir * dl - corr, dir), shaped(dir * dr + corr, dir));
}

static void turnStep(uint32_t now) {
  int32_t remaining = (turnTarget - imuYawCdeg()) * dir;
  int64_t rate = abs(imuRateCdps());
  int32_t brakeAt = (int32_t)(rate * brakeKx1000 / 1000 + rate * rate / brakeQdiv);
  if (remaining <= brakeAt) return halt(STOP_DONE, now);
  if ((int32_t)(now - kickUntil) < 0) {
    motorsSet(-dir * turnKickPct, dir * turnKickPct);
    return;
  }
  if (rate >= stallCdps) turningAt = now;
  else if ((int32_t)(now - turningAt) >= (int32_t)stallMs) return halt(STOP_STALL, now);
  int d = compensate(cal.turnPct);
  motorsSet(-dir * d, dir * d);
}

static void control(uint32_t now) {
  if (mode == MODE_BRAKE) {
    if ((int32_t)(now - brakeUntil) >= 0) {
      motorsCoast();
      mode = MODE_IDLE;
    }
    return;
  }
  if (!active()) return;
  if ((int32_t)(now - leaseUntil) >= 0) return halt(STOP_LEASE, now);
  if (!heartbeatFresh(now)) return halt(STOP_HEARTBEAT, now);
  if (battLevelMv() < cutoffMv) return halt(STOP_BATTERY, now);
  if (mode != MODE_DUTY && !imuOk()) return halt(STOP_IMU, now);
  if (movingForward()) {
    int32_t s = sonarMm(now);
    if (s >= 0 && s <= reflexMm()) return halt(STOP_REFLEX, now);
  }
  if (mode == MODE_DRIVE) driveStep(now);
  if (mode == MODE_TURN) turnStep(now);
}

int cmdSetDuty(int l, int r, int leaseMs) {
  uint32_t now = millis();
  if (l < -100 || l > 100 || r < -100 || r > 100 || leaseMs <= 0) return refuse(REF_BAD_ARG);
  int c = checkCommon(now);
  if (c) return refuse(c);
  if (l == 0 && r == 0) {
    if (active()) halt(STOP_CMD, now);
    return REF_OK;
  }
  dutyL = l;
  dutyR = r;
  beginMotion(MODE_DUTY, leaseMs, now);
  motorsSet(l, r);
  return REF_OK;
}

static int startDrive(int sign, int32_t mm, uint32_t ms, int speed, int leaseMs, int32_t stopMm) {
  uint32_t now = millis();
  int c = checkMotion(now);
  if (c) return refuse(c);
  if (mm > 0 && cal.mmPerEdgeX100 == 0 && cal.cruiseMmS <= 0) return refuse(REF_NO_CAL);
  dir = sign;
  targetMm = mm;
  durationMs = ms;
  sonarStopMm = stopMm;
  speedPct = speed > 0 ? speed : cal.cruisePct;
  yaw0 = imuYawCdeg();
  distMm = 0;
  encReset();
  encL = encR = speedEdges = 0;
  movedL = movedR = speedAt = now;
  speedMmS = 0;
  beginMotion(MODE_DRIVE, leaseMs, now);
  driveStep(now);
  return REF_OK;
}

int cmdDriveCm(int cm, int speed, int leaseMs) {
  if (cm == 0 || abs(cm) > 200 || speed < 0 || speed > 100 || leaseMs <= 0) return refuse(REF_BAD_ARG);
  return startDrive(cm > 0 ? 1 : -1, (int32_t)abs(cm) * 10, 0, speed, leaseMs, 0);
}

// Forward at cruise until the sonar reads <= stopMm, or after cm (the cap).
int cmdDriveUntil(int cm, int stopMm, int leaseMs) {
  if (cm <= 0 || cm > 200 || stopMm < 100 || stopMm > 2000 || leaseMs <= 0) return refuse(REF_BAD_ARG);
  return startDrive(1, (int32_t)cm * 10, 0, 0, leaseMs, stopMm);
}

// Fixed-time straight drive, used to measure cruise speed.
int cmdDriveMs(int ms, int speed, int leaseMs) {
  if (ms <= 0 || ms > 5000 || speed < 0 || speed > 100 || leaseMs <= 0) return refuse(REF_BAD_ARG);
  return startDrive(1, 0, (uint32_t)ms, speed, leaseMs, 0);
}

int cmdTurnDeg(int deg, int leaseMs) {
  uint32_t now = millis();
  if (deg == 0 || abs(deg) > 360 || leaseMs <= 0) return refuse(REF_BAD_ARG);
  int c = checkMotion(now);
  if (c) return refuse(c);
  dir = deg > 0 ? 1 : -1;
  turnTarget = imuYawCdeg() + (int32_t)deg * 100;
  beginMotion(MODE_TURN, leaseMs, now);
  turningAt = kickUntil;
  turnStep(now);
  return REF_OK;
}

int cmdLease(int leaseMs) {
  if (!active()) return refuse(REF_NOT_MOVING);
  if (leaseMs <= 0) return refuse(REF_BAD_ARG);
  leaseUntil = millis() + min((uint32_t)leaseMs, LEASE_MAX_MS);
  return REF_OK;
}

int cmdStop() {
  if (active()) halt(STOP_CMD, millis());
  return REF_OK;
}

int cmdHeartbeat(int seq) {
  hbMs = millis();
  return seq;
}

int cmdFace(int code) { return facesShow(code) ? REF_OK : refuse(REF_BAD_ARG); }

int cmdImuCal() {
  if (mode != MODE_IDLE) return -999999;
  return imuCalibrate();
}

int cmdSetCal(int cruisePct, int cruiseMmS, int battMv, int kickPct, int kickMs, int floorPct, int turnPct,
              int kpX10, int brakeMs, int mmPerEdgeX100) {
  bool ok = cruisePct >= 10 && cruisePct <= 100 && cruiseMmS >= 0 && cruiseMmS <= 2000 &&
            (battMv == 0 || (battMv >= 6000 && battMv <= 9000)) && kickPct >= 0 && kickPct <= 100 &&
            kickMs >= 0 && kickMs <= 500 && floorPct >= 0 && floorPct <= 100 && turnPct >= 10 &&
            turnPct <= 100 && kpX10 >= 0 && kpX10 <= 200 && brakeMs >= 0 && brakeMs <= 500 &&
            mmPerEdgeX100 >= 0 && mmPerEdgeX100 <= 10000;
  if (!ok) return refuse(REF_BAD_ARG);
  cal = {cruisePct, cruiseMmS, battMv, kickPct, kickMs, floorPct, turnPct, kpX10, brakeMs, mmPerEdgeX100, true};
  return REF_OK;
}

// Turn settings that depend on the floor; set_cal is near the 256-byte RPC buffer, so they come apart.
int cmdSetCal2(int kickPct, int stallRateCdps, int stallAfterMs, int lagMs, int rollAfterMs) {
  if (kickPct < 10 || kickPct > 100 || stallRateCdps < 100 || stallRateCdps > 5000 || stallAfterMs < 100 || stallAfterMs > 2000 ||
      lagMs < 0 || lagMs > 1000 || rollAfterMs < 0 || rollAfterMs > 1000)
    return refuse(REF_BAD_ARG);
  turnKickPct = kickPct;
  stallCdps = stallRateCdps;
  stallMs = (uint32_t)stallAfterMs;
  driveLagMs = (uint32_t)lagMs;
  rollMs = (uint32_t)rollAfterMs;
  return REF_OK;
}

// What the suite fits per floor: the turn brake rule, the reflex base, the sonar offset and a per-side drive trim.
int cmdSetCal3(int kX1000, int qDiv, int reflexBase, int sonarOffset, int trim) {
  if (kX1000 < 0 || kX1000 > 500 || qDiv < 10000 || qDiv > 5000000 || reflexBase < 60 || reflexBase > 400 ||
      sonarOffset < -100 || sonarOffset > 100 || trim < -20 || trim > 20)
    return refuse(REF_BAD_ARG);
  brakeKx1000 = kX1000;
  brakeQdiv = qDiv;
  reflexBaseMm = reflexBase;
  sonarOffsetMm = sonarOffset;
  sonarSetOffset(sonarOffset);
  trimPct = trim;
  return REF_OK;
}

// The last halt: when, which motion, and the yaw rate and heading at that moment (the suite fits the brake rule).
String cmdHaltInfo() {
  String s = String(haltMs);
  s += ',';
  s += haltMode;
  s += ',';
  s += haltRateCdps;
  s += ',';
  s += haltYawCdeg;
  s += ',';
  s += turnTarget;
  return s;
}

int cmdSetCutoff(int mv) {
  if (mv < 5000 || mv > 9000) return refuse(REF_BAD_ARG);
  cutoffMv = mv;
  return REF_OK;
}

// Fixed field order; rover/core/mcu.py parses it. Keep under the 256-byte RPC buffer.
String cmdState() {
  uint32_t now = millis();
  uint32_t l, r;
  encRead(l, r);
  int flags = (imuPresent() ? 1 : 0) | (imuOk() ? 2 : 0) | (cal.set ? 4 : 0) | (heartbeatFresh(now) ? 8 : 0) |
              (battLevelMv() >= cutoffMv ? 16 : 0) | (battSenseLost() ? 32 : 0);
  String s = String(now);
  s += ',';
  s += mode;
  s += ',';
  s += stopReason;
  s += ',';
  s += lastRefusal;
  s += ',';
  s += startMs;
  s += ',';
  s += haltMs;
  s += ',';
  s += (uint32_t)hbMs;
  s += ',';
  s += leaseUntil;
  s += ',';
  s += imuYawCdeg();
  s += ',';
  s += imuRateCdps();
  s += ',';
  s += sonarMm(now);
  s += ',';
  s += sonarRawMm();
  s += ',';
  s += battLevelMv();
  s += ',';
  s += l;
  s += ',';
  s += r;
  s += ',';
  s += distMm;
  s += ',';
  s += facesCurrent();
  s += ',';
  s += flags;
  s += ',';
  s += sonarPings();
  s += ',';
  s += battNowMv();
  s += ',';
  s += battMinMv();
  s += ',';
  s += imuResets();
  s += ',';
  s += imuBusErrors();
  return s;
}

String cmdInfo() {
  String s = "rover_mcu build=";
  s += BUILD;
  s += ",imu_who=";
  s += imuWho;
  s += ",cal=";
  s += cal.set ? 1 : 0;
  s += ",cutoff_mv=";
  s += cutoffMv;
  s += ",turn_kick_pct=";
  s += turnKickPct;
  s += ",stall=";
  s += stallCdps;
  s += "cdps/";
  s += stallMs;
  s += "ms,drive_lag_ms=";
  s += driveLagMs;
  s += ",roll_ms=";
  s += rollMs;
  s += ",brake_k=";
  s += brakeKx1000;
  s += ",brake_q=";
  s += brakeQdiv;
  s += ",reflex_base=";
  s += reflexBaseMm;
  s += ",sonar_offset=";
  s += sonarOffsetMm;
  s += ",trim=";
  s += trimPct;
  s += ",batt_drops=";
  s += battDrops();
  return s;
}

void setup() {
  motorsInit();
  facesInit();
  facesShow(FACE_IDLE);
  encInit();
  sonarInit();
  imuWho = imuInit();
  battReset(readBattMv());
  Bridge.begin();
  Bridge.provide("heartbeat", cmdHeartbeat);
  Bridge.provide_safe("set_duty", cmdSetDuty);
  Bridge.provide_safe("drive_cm", cmdDriveCm);
  Bridge.provide_safe("drive_ms", cmdDriveMs);
  Bridge.provide_safe("drive_until", cmdDriveUntil);
  Bridge.provide_safe("turn_deg", cmdTurnDeg);
  Bridge.provide_safe("lease", cmdLease);
  Bridge.provide_safe("stop", cmdStop);
  Bridge.provide_safe("face", cmdFace);
  Bridge.provide_safe("imu_cal", cmdImuCal);
  Bridge.provide_safe("set_cal", cmdSetCal);
  Bridge.provide_safe("set_cal2", cmdSetCal2);
  Bridge.provide_safe("set_cal3", cmdSetCal3);
  Bridge.provide_safe("halt_info", cmdHaltInfo);
  Bridge.provide_safe("set_cutoff", cmdSetCutoff);
  Bridge.provide_safe("state", cmdState);
  Bridge.provide_safe("info", cmdInfo);
  facesShow(FACE_READY);
  nextTick = millis();
}

void loop() {
  uint32_t now = millis();
  if (!imuPresent() && !active() && (int32_t)(now - imuRetryAt) >= 0) {
    imuWho = imuProbe();
    imuRetryAt = now + IMU_RETRY_MS;
  }
  imuStep();
  sonarStep(now);
  battStep(now);
  if ((int32_t)(now - nextTick) >= 0) {
    nextTick += CONTROL_PERIOD_MS;
    if ((int32_t)(now - nextTick) >= 0) nextTick = now + CONTROL_PERIOD_MS;
    control(now);
  }
}
// 2026-11-06T00:05:00
// 2026-11-06T21:22:00
