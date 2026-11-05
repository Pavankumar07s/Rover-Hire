#include "aht20.h"
#include <Wire.h>
#include "config.h"

static bool write3(uint8_t a, uint8_t b, uint8_t c) {
  Wire.beginTransmission(AHT20_ADDR);
  Wire.write(a);
  Wire.write(b);
  Wire.write(c);
  return Wire.endTransmission() == 0;
}

static int readStatus() {
  if (Wire.requestFrom(AHT20_ADDR, (uint8_t)1) != 1) return -1;
  return Wire.read();
}

// CRC-8, polynomial 0x31, init 0xFF (AHT20 datasheet).
static uint8_t crc8(const uint8_t *d, uint8_t n) {
  uint8_t crc = 0xFF;
  for (uint8_t i = 0; i < n; i++) {
    crc ^= d[i];
    for (uint8_t b = 0; b < 8; b++) crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
  }
  return crc;
}

bool ahtInit() {
  delay(40); // power-up time
  int st = readStatus();
  if (st < 0) return false;
  if (!(st & 0x08)) { // not calibrated: send the initialise command
    if (!write3(0xBE, 0x08, 0x00)) return false;
    delay(10);
    st = readStatus();
  }
  return st >= 0 && (st & 0x08);
}

bool ahtTrigger() { return write3(0xAC, 0x33, 0x00); }

bool ahtRead(int32_t &tempCc, int32_t &rhCpct) {
  uint8_t d[7];
  if (Wire.requestFrom(AHT20_ADDR, (uint8_t)7) != 7) return false;
  for (uint8_t i = 0; i < 7; i++) d[i] = Wire.read();
  if (d[0] & 0x80) return false;          // still busy
  if (crc8(d, 6) != d[6]) return false;   // corrupted on the wire
  uint32_t rawRh = ((uint32_t)d[1] << 12) | ((uint32_t)d[2] << 4) | (d[3] >> 4);
  uint32_t rawT = (((uint32_t)d[3] & 0x0F) << 16) | ((uint32_t)d[4] << 8) | d[5];
  rhCpct = (int32_t)(((uint64_t)rawRh * 10000) >> 20);
  tempCc = (int32_t)(((uint64_t)rawT * 20000) >> 20) - 5000;
  return true;
}
