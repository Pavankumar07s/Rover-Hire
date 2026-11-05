#include "batt.h"

static int32_t ring[BATT_WINDOW];
static int next = 0;
static int32_t level = 0;
static int32_t newest = 0;
static int32_t lowest = 0;
static bool lost = false;
static uint32_t lostSinceMs = 0;
static uint32_t drops = 0;

static int32_t median() {
  int32_t s[BATT_WINDOW];
  for (int i = 0; i < BATT_WINDOW; i++) {
    int j = i;
    while (j > 0 && s[j - 1] > ring[i]) {
      s[j] = s[j - 1];
      j--;
    }
    s[j] = ring[i];
  }
  return (s[BATT_WINDOW / 2 - 1] + s[BATT_WINDOW / 2]) / 2;
}

void battReset(int32_t mv) {
  for (int i = 0; i < BATT_WINDOW; i++) ring[i] = mv;
  level = newest = lowest = mv;
  lost = false;
}

void battSample(uint32_t nowMs, int32_t mv) {
  newest = mv;
  if (mv < lowest) lowest = mv;
  if (mv < BATT_SENSE_LOST_MV) {
    if (!lost) {
      lost = true;
      lostSinceMs = nowMs;
      drops++;
    }
    if (nowMs - lostSinceMs < BATT_SENSE_HOLD_MS) return;
  } else {
    lost = false;
  }
  ring[next] = mv;
  next = (next + 1) % BATT_WINDOW;
  level = median();
}

int32_t battLevelMv() { return level; }
int32_t battNowMv() { return newest; }
int32_t battMinMv() { return lowest; }
void battMarkMin() { lowest = newest; }
bool battSenseLost() { return lost; }
uint32_t battDrops() { return drops; }
