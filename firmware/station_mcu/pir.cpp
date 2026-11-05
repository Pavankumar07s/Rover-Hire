#include "pir.h"
#include "config.h"

static volatile uint32_t count = 0;
static volatile uint32_t lastMs = 0;

static void isr() {
  uint32_t t = millis();
  if (count == 0 || t - lastMs >= PIR_MIN_GAP_MS) count++;
  lastMs = t;
}

void pirInit() {
  pinMode(pin::PIR, INPUT);
  attachInterrupt(digitalPinToInterrupt(pin::PIR), isr, RISING);
}

void pirRead(uint32_t &c, uint32_t &l) {
  noInterrupts();
  c = count;
  l = lastMs;
  interrupts();
}
