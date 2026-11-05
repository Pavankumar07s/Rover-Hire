// Station-A MCU (plan Phase 12): samples the AHT20, BMP280 and LDR once a second and counts PIR detections. Linux reads
// it all with station_state(). A failed read clears that sensor's ok flag and counts an I2C error; an old value is never
// passed off as fresh (sample_ms says when the last good sample was taken).
#include <Arduino_RouterBridge.h>
#include <Wire.h>
#include "aht20.h"
#include "bmp280.h"
#include "config.h"
#include "pir.h"

static int32_t tAhtCc = 0, rhCpct = 0, tBmpCc = 0, pPa = 0;
static int32_t lightRaw = 0;
static uint32_t i2cErr = 0, sampleMs = 0, nextSample = 0, triggeredAt = 0;
static bool okAht = false, okBmp = false, okPress = false, ahtReady = false, pending = false;

// t_aht_cc,rh_cpct,t_bmp_cc,p_pa,light_raw,motion_count,motion_last_ms,i2c_err,ok_aht,ok_bmp,uptime_ms,sample_ms,ok_press
String cmdStationState() {
  uint32_t motions, motionLast;
  pirRead(motions, motionLast);
  String s = String(tAhtCc);
  s += ','; s += rhCpct;
  s += ','; s += tBmpCc;
  s += ','; s += pPa;
  s += ','; s += lightRaw;
  s += ','; s += motions;
  s += ','; s += motionLast;
  s += ','; s += i2cErr;
  s += ','; s += okAht ? 1 : 0;
  s += ','; s += okBmp ? 1 : 0;
  s += ','; s += millis();
  s += ','; s += sampleMs;
  s += ','; s += okPress ? 1 : 0;
  return s;
}

// I2C addresses that answer, for the wiring check: "0x38,0x77"
String cmdI2cScan() {
  String s;
  for (uint8_t a = 0x08; a < 0x78; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      if (s.length()) s += ',';
      s += "0x";
      if (a < 16) s += '0';
      s += String(a, HEX);
    }
  }
  return s;
}

static void sample(uint32_t now) {
  int32_t t, rh, tb, p;
  bool aht = ahtReady && ahtRead(t, rh);
  if (aht) { tAhtCc = t; rhCpct = rh; } else { i2cErr++; ahtReady = false; } // re-initialised on the next cycle
  okAht = aht;
  bool press = false;
  bool bmp = bmpRead(tb, p, press);
  if (!bmp) { i2cErr++; bmpInit(); } // after a power loss it wakes up asleep: set it up again
  else tBmpCc = tb;
  okBmp = bmp;
  okPress = bmp && press;
  pPa = okPress ? p : 0;
  lightRaw = analogRead(pin::LDR);
  if (aht && bmp) sampleMs = now;
}

void setup() {
  Wire.begin();
  Wire.setClock(100000);
  ahtReady = ahtInit();
  bmpInit();
  pirInit();
  nextSample = millis() + SAMPLE_MS; // the BMP280's first measurement is ready by then
  Bridge.begin();
  Bridge.provide_safe("station_state", cmdStationState);
  Bridge.provide_safe("i2c_scan", cmdI2cScan);
  Bridge.provide_safe("bmp_info", bmpInfo);
}

void loop() {
  uint32_t now = millis();
  if (!pending && (int32_t)(now - nextSample) >= 0) {
    if (!ahtReady) ahtReady = ahtInit();
    pending = ahtReady && ahtTrigger();
    triggeredAt = now;
    nextSample = now + SAMPLE_MS;
    if (!pending) sample(now); // the AHT20 is missing: still read the rest, and count the error
  }
  if (pending && now - triggeredAt >= AHT_CONVERT_MS) {
    pending = false;
    sample(now);
  }
  delay(5);
}
// 2026-11-06T21:54:00
