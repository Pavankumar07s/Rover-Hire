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
