#include "motors.h"
#include "config.h"

static void side(int en, int a, int b, int pct) {
  pct = constrain(pct, -100, 100);
  digitalWrite(a, pct > 0 ? HIGH : LOW);
  digitalWrite(b, pct < 0 ? HIGH : LOW);
  analogWrite(en, (abs(pct) * 255) / 100);
}

static void inputsLow() {
  digitalWrite(pin::IN1, LOW);
  digitalWrite(pin::IN2, LOW);
  digitalWrite(pin::IN3, LOW);
  digitalWrite(pin::IN4, LOW);
}

void motorsInit() {
  pinMode(pin::IN1, OUTPUT);
  pinMode(pin::IN2, OUTPUT);
  pinMode(pin::IN3, OUTPUT);
  pinMode(pin::IN4, OUTPUT);
  inputsLow();
  analogWrite(pin::ENA, 0);
  analogWrite(pin::ENB, 0);
}

// + is forward on both sides as wired (left pair's leads swapped).
void motorsSet(int leftPct, int rightPct) {
  side(pin::ENA, pin::IN1, pin::IN2, leftPct);
  side(pin::ENB, pin::IN3, pin::IN4, rightPct);
}

// Both inputs low with the enable high shorts each motor: a short brake.
void motorsBrake() {
  inputsLow();
  analogWrite(pin::ENA, 255);
  analogWrite(pin::ENB, 255);
}

void motorsCoast() {
  inputsLow();
  analogWrite(pin::ENA, 0);
  analogWrite(pin::ENB, 0);
}
// 2026-11-06T00:19:00
// 2026-11-06T21:30:00
// 2026-11-06T22:21:50
