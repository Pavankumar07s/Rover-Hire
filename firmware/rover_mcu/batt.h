#pragma once
#include <stdint.h>

// The motor battery as read through the A0 divider. A loose sense wire under vibration reads 4-6 V for one sample and
// drops to ~0-2.3 V while the pack holds 8 V (2-8 dips a mission; a live run ended at "7.1 V" on a 1 s mean).
// So the level is the median of the last second, and a reading under BATT_SENSE_LOST_MV is held out until it has lasted
// BATT_SENSE_HOLD_MS: then it is real (the motor switch is off or the pack is unplugged) and the level falls.
constexpr int BATT_WINDOW = 20;  // one second of 50 ms samples
constexpr int32_t BATT_SENSE_LOST_MV = 4000;  // a 2S pack never reads this low while connected and switched on
constexpr uint32_t BATT_SENSE_HOLD_MS = 2000;

void battReset(int32_t mv);
void battSample(uint32_t nowMs, int32_t mv);
int32_t battLevelMv();  // median of the last second, with dropouts held out: what stops and refusals use
int32_t battNowMv();    // the newest reading, as read
int32_t battMinMv();    // the lowest reading since battMarkMin(), as read (dropouts included, so a loose wire shows)
void battMarkMin();
bool battSenseLost();   // the newest reading is a dropout
uint32_t battDrops();   // dropouts since boot
