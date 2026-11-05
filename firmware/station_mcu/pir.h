#pragma once
#include <Arduino.h>

// HC-SR501 on D2: rising edges counted by interrupt; edges closer than PIR_MIN_GAP_MS count once.
void pirInit();
void pirRead(uint32_t &count, uint32_t &lastMs);
