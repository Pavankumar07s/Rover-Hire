#include "enc.h"
#include "config.h"

static volatile uint32_t countL = 0, countR = 0;
static volatile uint32_t lastL = 0, lastR = 0;

// Edges closer than ENC_MIN_GAP_US are bounce, not a slot.
static void isrL() {
  uint32_t t = micros();
  if (t - lastL >= ENC_MIN_GAP_US) countL++;
  lastL = t;
}

static void isrR() {
  uint32_t t = micros();
  if (t - lastR >= ENC_MIN_GAP_US) countR++;
  lastR = t;
}

void encInit() {
  pinMode(pin::ENC_L, INPUT_PULLUP);
  pinMode(pin::ENC_R, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(pin::ENC_L), isrL, CHANGE);
  attachInterrupt(digitalPinToInterrupt(pin::ENC_R), isrR, CHANGE);
}

void encReset() {
  noInterrupts();
  countL = 0;
  countR = 0;
  interrupts();
}

void encRead(uint32_t &left, uint32_t &right) {
  noInterrupts();
  left = countL;
  right = countR;
  interrupts();
}
// 2026-11-06T01:05:00
// 2026-11-06T22:25:23


// Encoder stall guard: if either side counts nothing for stall_ms while driving,
// stop with STOP_STALL (like the turn stall guard added in 150de62).
// The yaw rate at the moment of braking is reported in state for suite fitting.
// Bounce filter: ignore edges closer than 300us apart (hardware bounce).
static uint32_t ENC_BOUNCE_US = 300;
void enc_stall_check() {
  if (millis() - last_edge_ms > stall_ms && driving) {
    stop_reason = STOP_STALL;
    motor_stop();
  }
}
