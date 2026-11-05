#pragma once
#include <Arduino.h>

// BMP280 by raw Wire, in normal mode (it samples by itself); compensation with Bosch's integer formulas.
bool bmpInit();          // finds it at 0x76 or 0x77 (chip id 0x58, 0x56/0x57 or BME280 0x60) and reads its calibration
uint8_t bmpAddr();       // 0 when not found
String bmpInfo();        // chip id at each address, for the wiring check
// true when the temperature is good; pressureOk only when the pressure is plausible (this module's element can fail alone)
bool bmpRead(int32_t &tempCc, int32_t &pressurePa, bool &pressureOk);
