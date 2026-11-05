#pragma once
// Station-A (plan Phase 12): pins and timing. Wiring: plan.md §12.3.
#include <Arduino.h>

namespace pin {
constexpr uint8_t PIR = 2;  // HC-SR501 OUT, 5 V module, 3.3 V-safe output
constexpr uint8_t LDR = A0; // LM393 module AO, powered from IOREF (3.3 V)
}

constexpr uint8_t AHT20_ADDR = 0x38;
constexpr uint8_t BMP280_ADDRS[] = {0x76, 0x77};

constexpr uint32_t SAMPLE_MS = 1000;   // one sample a second
constexpr uint32_t AHT_CONVERT_MS = 85; // datasheet: 80 ms after the trigger
constexpr uint32_t PIR_MIN_GAP_MS = 500; // a rising edge closer than this is the same detection
