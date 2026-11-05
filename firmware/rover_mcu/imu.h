#pragma once
#include <Arduino.h>

int imuInit();
int imuProbe();  // looks for the chip again on a bus already begun; -1 if it does not answer
int32_t imuCalibrate();
void imuStep();
bool imuPresent();
bool imuOk();
int32_t imuYawCdeg();
int32_t imuRateCdps();
uint32_t imuResets();
uint32_t imuBusErrors();
// 2026-11-06T00:57:00
