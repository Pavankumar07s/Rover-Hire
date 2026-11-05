#include "sonar.h"
#include "config.h"

static volatile uint32_t riseUs = 0;
static volatile uint32_t widthUs = 0;
static volatile bool echoDone = false;

static bool inFlight = false;
static uint32_t pingMs = 0;
static uint32_t pingUs = 0;
static uint32_t pings = 0;
static int32_t rawMm = -1;
static int32_t hist[3] = {-1, -1, -1};
static uint8_t histCount = 0;
static uint8_t histNext = 0;
static uint32_t lastValidMs = 0;
static int32_t offsetMm = DEFAULT_SONAR_OFFSET_MM;

static void isrEcho() {
  uint32_t t = micros();
  if (digitalRead(pin::SONAR_ECHO)) {
    riseUs = t;
  } else if (riseUs) {
    widthUs = t - riseUs;
    echoDone = true;
  }
}

static int32_t median3(int32_t a, int32_t b, int32_t c) {
  return max(min(a, b), min(max(a, b), c));
}

void sonarInit() {
  pinMode(pin::SONAR_TRIG, OUTPUT);
  digitalWrite(pin::SONAR_TRIG, LOW);
  pinMode(pin::SONAR_ECHO, INPUT);  // the divider's 2k to GND holds it low between echoes
  attachInterrupt(digitalPinToInterrupt(pin::SONAR_ECHO), isrEcho, CHANGE);
}

void sonarStep(uint32_t nowMs) {
  if (inFlight) {
    if (echoDone) {
      // 28 C: sound covers 0.1741 mm/us one way after halving the round trip.
      rawMm = (int32_t)(widthUs * 1741 / 10000) + offsetMm;
      hist[histNext] = rawMm;
      histNext = (histNext + 1) % 3;
      if (histCount < 3) histCount++;
      lastValidMs = nowMs;
      inFlight = false;
      pings++;
    } else if (micros() - pingUs > ECHO_TIMEOUT_US) {
      rawMm = -1;
      inFlight = false;
      pings++;
    }
  }
  if (inFlight || nowMs - pingMs < PING_PERIOD_MS) return;
  pingMs = nowMs;
  if (digitalRead(pin::SONAR_ECHO)) {
    rawMm = -2;  // echo still high from the last ping
    pings++;
    return;
  }
  noInterrupts();
  riseUs = 0;
  echoDone = false;
  interrupts();
  digitalWrite(pin::SONAR_TRIG, HIGH);
  delayMicroseconds(12);
  digitalWrite(pin::SONAR_TRIG, LOW);
  pingUs = micros();
  inFlight = true;
}

// Median of the last 3 echoes; -1 when none is fresh.
int32_t sonarMm(uint32_t nowMs) {
  if (histCount == 0 || nowMs - lastValidMs > SONAR_STALE_MS) return -1;
  if (histCount < 3) return hist[(histNext + 2) % 3];
  return median3(hist[0], hist[1], hist[2]);
}

int32_t sonarRawMm() { return rawMm; }
uint32_t sonarPings() { return pings; }

void sonarSetOffset(int32_t mm) { offsetMm = mm; }
// 2026-11-06T00:34:00
// 2026-11-06T22:23:01
