#include "bmp280.h"
#include <Wire.h>
#include "config.h"

static uint8_t addr = 0;
static uint16_t T1, P1;
static int16_t T2, T3, P2, P3, P4, P5, P6, P7, P8, P9;

static bool readRegs(uint8_t a, uint8_t reg, uint8_t *buf, uint8_t n) {
  Wire.beginTransmission(a);
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(a, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

static bool writeReg(uint8_t a, uint8_t reg, uint8_t v) {
  Wire.beginTransmission(a);
  Wire.write(reg);
  Wire.write(v);
  return Wire.endTransmission() == 0;
}

static uint16_t u16(const uint8_t *b) { return (uint16_t)(b[0] | (b[1] << 8)); }
static int16_t s16(const uint8_t *b) { return (int16_t)u16(b); }

bool bmpInit() {
  addr = 0;
  for (uint8_t a : BMP280_ADDRS) {
    uint8_t id = 0;
    // 0x58 BMP280; 0x56/0x57 early BMP280 samples; 0x60 BME280: the same temperature and pressure registers
    if (readRegs(a, 0xD0, &id, 1) && (id == 0x58 || id == 0x56 || id == 0x57 || id == 0x60)) { addr = a; break; }
  }
  if (!addr) return false;
  uint8_t c[24];
  if (!readRegs(addr, 0x88, c, 24)) { addr = 0; return false; }
  T1 = u16(c + 0); T2 = s16(c + 2); T3 = s16(c + 4);
  P1 = u16(c + 6); P2 = s16(c + 8); P3 = s16(c + 10); P4 = s16(c + 12); P5 = s16(c + 14);
  P6 = s16(c + 16); P7 = s16(c + 18); P8 = s16(c + 20); P9 = s16(c + 22);
  // config: standby 500 ms, filter x16; ctrl_meas: temperature x2, pressure x16, normal mode
  return writeReg(addr, 0xF5, 0x90) && writeReg(addr, 0xF4, 0x57);
}

uint8_t bmpAddr() { return addr; }

String bmpInfo() {
  String s;
  for (uint8_t a : BMP280_ADDRS) {
    uint8_t id = 0;
    bool ok = readRegs(a, 0xD0, &id, 1);
    if (s.length()) s += ',';
    s += "0x" + String(a, HEX) + "=" + (ok ? "0x" + String(id, HEX) : String("none"));
  }
  s += ",using=0x" + String(addr, HEX);
  if (!addr) return s;
  uint8_t r[3], d[6];
  if (readRegs(addr, 0xF3, r, 3)) s += ",status=0x" + String(r[0], HEX) + ",ctrl=0x" + String(r[1], HEX) + ",config=0x" + String(r[2], HEX);
  if (readRegs(addr, 0xF7, d, 6)) {
    s += ",raw=";
    for (uint8_t i = 0; i < 6; i++) { if (d[i] < 16) s += '0'; s += String(d[i], HEX); }
  }
  int32_t t = 0, p = 0;
  bool pok = false;
  bool ok = bmpRead(t, p, pok);
  return s + ",temp=" + (ok ? "ok" : "fail") + ",pressure=" + (pok ? "ok" : "fail") + ",t_cc=" + String(t) + ",p_pa=" + String(p);
}

bool bmpRead(int32_t &tempCc, int32_t &pressurePa, bool &pressureOk) {
  pressureOk = false;
  pressurePa = 0;
  if (!addr) return false;
  uint8_t d[6];
  if (!readRegs(addr, 0xF7, d, 6)) return false;
  int32_t adcP = ((int32_t)d[0] << 12) | ((int32_t)d[1] << 4) | (d[2] >> 4);
  int32_t adcT = ((int32_t)d[3] << 12) | ((int32_t)d[4] << 4) | (d[5] >> 4);
  if (adcT == 0x80000) return false; // no temperature yet
  int32_t v1 = ((((adcT >> 3) - ((int32_t)T1 << 1))) * ((int32_t)T2)) >> 11;
  int32_t v2 = (((((adcT >> 4) - ((int32_t)T1)) * ((adcT >> 4) - ((int32_t)T1))) >> 12) * ((int32_t)T3)) >> 14;
  int32_t tFine = v1 + v2;
  tempCc = (tFine * 5 + 128) >> 8;
  if (adcP == 0x80000 || adcP >= 0xFFFF0) return true; // pressure skipped or stuck at full scale (a faulty element)
  int64_t p1 = ((int64_t)tFine) - 128000;
  int64_t p2 = p1 * p1 * (int64_t)P6;
  p2 = p2 + ((p1 * (int64_t)P5) << 17);
  p2 = p2 + (((int64_t)P4) << 35);
  p1 = ((p1 * p1 * (int64_t)P3) >> 8) + ((p1 * (int64_t)P2) << 12);
  p1 = (((((int64_t)1) << 47) + p1)) * ((int64_t)P1) >> 33;
  if (p1 == 0) return true;
  int64_t p = 1048576 - adcP;
  p = (((p << 31) - p2) * 3125) / p1;
  p1 = (((int64_t)P9) * (p >> 13) * (p >> 13)) >> 25;
  p2 = (((int64_t)P8) * p) >> 19;
  p = ((p + p1 + p2) >> 8) + (((int64_t)P7) << 4);
  int32_t pa = (int32_t)(p >> 8); // Q24.8 → Pa
  pressureOk = pa > 30000 && pa < 110000;
  if (pressureOk) pressurePa = pa;
  return true;
}
