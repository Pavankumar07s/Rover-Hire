#include "imu.h"
#include <Wire.h>

static constexpr float GYRO_LSB_PER_DPS = 65.5f;  // +-500 deg/s range
static constexpr uint32_t STEP_US = 5000;
static constexpr uint32_t MAX_ERR_STREAK = 10;

static uint8_t addr = 0;
static bool present = false;
static bool calibrated = false;
static float yawDeg = 0;
static float rateDps = 0;
static float biasRaw = 0;
static uint32_t lastUs = 0;
static uint32_t errStreak = 0;

static bool writeReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

static bool readRegs(uint8_t reg, uint8_t *buf, int n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return false;
  if ((int)Wire.requestFrom(addr, (size_t)n) != n) return false;
  for (int i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

static bool readGyroZ(int16_t &raw) {
  uint8_t b[2];
  if (!readRegs(0x47, b, 2)) return false;
  raw = (int16_t)((b[0] << 8) | b[1]);
  return true;
}

static constexpr uint8_t PWR_AWAKE_PLL = 0x01;
static constexpr uint32_t HEALTH_PERIOD_US = 500000;
static uint32_t healthUs = 0;
static uint32_t resets = 0;
static uint32_t busErrors = 0;

static void configure() {
  writeReg(0x6B, PWR_AWAKE_PLL);  // wake, gyro PLL clock
  writeReg(0x1A, 0x03);           // DLPF ~44 Hz
  writeReg(0x19, 0x04);           // 200 Hz sample rate
  writeReg(0x1B, 0x08);           // gyro +-500 deg/s
  writeReg(0x1C, 0x00);           // accel +-2 g
}

static bool awake() {
  uint8_t pwr = 0;
  return readRegs(0x6B, &pwr, 1) && pwr == PWR_AWAKE_PLL;
}

int imuInit() {
  Wire.begin();
  Wire.setClock(400000);
  return imuProbe();
}

int imuProbe() {
  uint8_t who = 0;
  for (uint8_t a = 0x68; a <= 0x69; a++) {
    addr = a;
    if (readRegs(0x75, &who, 1)) break;
    addr = 0;
  }
  if (!addr) return -1;
  writeReg(0x6B, 0x80);  // reset
  delay(100);
  configure();
  delay(50);
  readRegs(0x75, &who, 1);
  present = true;
  lastUs = micros();
  healthUs = lastUs;
  return who;
}

// Rover must be still for ~1.2 s.
int32_t imuCalibrate() {
  if (!present) return -999999;
  if (!awake()) {
    configure();
    delay(50);
    if (!awake()) return -999999;
  }
  long sum = 0;
  int n = 0, zeros = 0;
  for (int i = 0; i < 400; i++) {
    int16_t raw;
    if (readGyroZ(raw)) {
      sum += raw;
      n++;
      if (raw == 0) zeros++;
    }
    delay(3);
  }
  if (n < 300 || zeros == n) return -999999;  // all zeros = chip asleep, not a real reading
  biasRaw = (float)sum / n;
  yawDeg = 0;
  rateDps = 0;
  errStreak = 0;
  calibrated = true;
  lastUs = micros();
  return (int32_t)(biasRaw * 100);
}

// A reset MPU-6050 wakes up asleep and reads all zeros without any I2C error, so check its power register.
// A failed read is a bus error (counted, calibration kept); only a readable wrong value is a reset.
static void healthCheck(uint32_t now) {
  if (now - healthUs < HEALTH_PERIOD_US) return;
  healthUs = now;
  uint8_t pwr = 0;
  if (!readRegs(0x6B, &pwr, 1)) {
    busErrors++;
    return;
  }
  if (pwr == PWR_AWAKE_PLL) return;
  resets++;
  calibrated = false;
  rateDps = 0;
  configure();
}

void imuStep() {
  if (!present) return;
  uint32_t now = micros();
  healthCheck(now);
  if (now - lastUs < STEP_US) return;
  int16_t raw;
  if (readGyroZ(raw)) {
    rateDps = (raw - biasRaw) / GYRO_LSB_PER_DPS;
    if (calibrated) yawDeg += rateDps * ((now - lastUs) * 1e-6f);
    errStreak = 0;
  } else {
    errStreak++;
  }
  lastUs = now;
}

bool imuPresent() { return present; }
bool imuOk() { return present && calibrated && errStreak < MAX_ERR_STREAK; }
int32_t imuYawCdeg() { return (int32_t)(yawDeg * 100); }  // + is counter-clockwise (left)
int32_t imuRateCdps() { return (int32_t)(rateDps * 100); }
uint32_t imuResets() { return resets; }
uint32_t imuBusErrors() { return busErrors; }
// 2026-11-06T00:49:00
// 2026-11-06T22:24:12


// Power register check: MPU-6050 wakes up asleep after a power glitch.
// Poll PWR_MGMT_1 every 500ms; if it reads 0x40 (sleep bit), reconfigure.
void imu_check_reset() {
  uint8_t pwr = imu_read_reg(0x6B);
  if (pwr == 0 || (pwr & 0x40)) {
    imu_configure();
    imu_resets++;
    calibrated = false;
  }
}
