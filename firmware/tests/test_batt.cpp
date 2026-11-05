// Host test of firmware/rover_mcu/batt.cpp, outside the sketch folder so the firmware build never compiles it.
// rover/tests/test_firmware.py builds and runs it: g++ -std=c++17 -I firmware/rover_mcu <this> firmware/rover_mcu/batt.cpp
#include <cstdio>
#include <cstdlib>

#include "batt.h"

static int failures = 0;
static uint32_t t = 0;

static void check(bool ok, const char* what, long got) {
  if (!ok) {
    std::printf("FAIL %s (got %ld)\n", what, got);
    failures++;
  }
}

static void feed(int32_t mv, uint32_t ms) {
  for (uint32_t end = t + ms; t < end; t += 50) battSample(t, mv);
}

static int32_t lowestLevel(int32_t base, int32_t dip, int every, uint32_t ms) {
  int32_t low = battLevelMv();
  for (uint32_t end = t + ms, n = 0; t < end; t += 50, n++) {
    battSample(t, n % every == 0 ? dip : base);
    if (battLevelMv() < low) low = battLevelMv();
  }
  return low;
}

int main() {
  battReset(8400);
  feed(8400, 2000);
  check(battLevelMv() == 8400, "a steady pack reads steady", battLevelMv());

  // missions: one 4.2-6.0 V reading now and then while the pack holds 8 V under load
  int32_t low = lowestLevel(8000, 4500, 4, 5000);
  check(low >= 7900, "single partial dips do not move the level", low);
  battMarkMin();
  battSample(t, 4214);
  t += 50;
  check(battMinMv() == 4214, "the lowest reading still shows the loose wire", battMinMv());
  check(battLevelMv() >= 7900, "and the level ignores it", battLevelMv());

  // A live run: dropouts to ~2.3 V for 300 ms inside a second pulled the old mean to 7.1 V and ended the mission
  feed(8300, 1000);
  uint32_t drops = battDrops();
  low = battLevelMv();
  feed(2300, 300);
  check(battSenseLost(), "a dropout is flagged", battSenseLost());
  for (int i = 0; i < 20; i++) {
    feed(8300, 400);
    feed(2300, 300);
    if (battLevelMv() < low) low = battLevelMv();
  }
  check(low >= 8200, "dropouts under 2 s are held out", low);
  check(battDrops() == drops + 21, "each dropout is counted", (long)(battDrops() - drops));
  feed(8300, 100);
  check(!battSenseLost(), "the flag clears when the reading comes back", battSenseLost());

  // the motor switch turned off: 0 V for good; the level must fall within 2.5 s (2 s hold + half the window)
  feed(8300, 1000);
  uint32_t off = t;
  while (battLevelMv() >= 7000 && t < off + 5000) feed(0, 50);
  check(t - off <= 2600, "a switched-off pack reads low after the hold", (long)(t - off));
  check(t - off >= 2000, "but not before the hold", (long)(t - off));

  // switched on again: the level is back within a second
  uint32_t on = t;
  while (battLevelMv() < 8000 && t < on + 3000) feed(8400, 50);
  check(t - on <= 600, "switching on is seen within 0.6 s", (long)(t - on));

  // a real pack running down slowly is followed
  for (int32_t mv = 8400; mv >= 6800; mv -= 10) feed(mv, 100);
  check(battLevelMv() <= 6900, "a slow real drop is followed", battLevelMv());

  // boot with the motor switch off, then on
  t = 0;
  battReset(30);
  feed(30, 3000);
  check(battLevelMv() < 4000, "off at boot reads off", battLevelMv());
  on = t;
  while (battLevelMv() < 8000 && t < on + 3000) feed(8400, 50);
  check(t - on <= 600, "then on within 0.6 s", (long)(t - on));

  if (failures == 0) std::printf("ok\n");
  return failures == 0 ? 0 : 1;
}
