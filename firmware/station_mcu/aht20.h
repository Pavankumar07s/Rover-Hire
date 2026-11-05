#pragma once
#include <Arduino.h>

// AHT20 by raw Wire: trigger a measurement, read it AHT_CONVERT_MS later. Values are kept only when the sensor says the
// conversion is done and the CRC matches.
bool ahtInit();
bool ahtTrigger();
bool ahtRead(int32_t &tempCc, int32_t &rhCpct);
