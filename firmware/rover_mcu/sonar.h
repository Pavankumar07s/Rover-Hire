#pragma once
#include <Arduino.h>

void sonarInit();
void sonarStep(uint32_t nowMs);
int32_t sonarMm(uint32_t nowMs);
int32_t sonarRawMm();
uint32_t sonarPings();
void sonarSetOffset(int32_t mm);
// 2026-11-06T00:41:00
