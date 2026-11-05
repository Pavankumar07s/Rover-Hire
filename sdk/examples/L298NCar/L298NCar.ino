/*
 * OxBS — L298N car
 *
 * Connect Wi-Fi in this sketch (the SDK does not).
 * Move forward: dynamic price from `seconds`.
 * Move backward: static price $0.01.
 *
 * Board: ESP32
 * Libraries: OxBS, PubSubClient, ArduinoJson v7
 *
 * Dashboard: https://app.0xbs.org
 */

#include <WiFi.h>
#include <OxBS.h>

namespace DeviceConfig {
  constexpr const char *kWifiSsid = "YOUR_WIFI_SSID";
  constexpr const char *kWifiPassword = "YOUR_WIFI_PASSWORD";

  constexpr const char *kConnectorId = "YOUR_CONNECTOR_ID";
  constexpr const char *kApiKey = "YOUR_API_KEY";

  constexpr const char *kServiceIdMoveForward = "YOUR_FORWARD_SERVICE_ID";
  constexpr const char *kServiceIdMoveBackward = "YOUR_BACKWARD_SERVICE_ID";

  constexpr uint32_t kWifiConnectTimeoutMs = 30000;
}

namespace HardwareConfig {
  constexpr int kMotor1Pin1 = 12;  // L298N IN1
  constexpr int kMotor1Pin2 = 13;  // L298N IN2
  constexpr int kMotor2Pin1 = 14;  // L298N IN3
  constexpr int kMotor2Pin2 = 27;  // L298N IN4
}

OxBS oxbs;

void moveForward() {
  digitalWrite(HardwareConfig::kMotor1Pin1, HIGH);
  digitalWrite(HardwareConfig::kMotor1Pin2, LOW);
  digitalWrite(HardwareConfig::kMotor2Pin1, HIGH);
  digitalWrite(HardwareConfig::kMotor2Pin2, LOW);
}

void moveBackward() {
  digitalWrite(HardwareConfig::kMotor1Pin1, LOW);
  digitalWrite(HardwareConfig::kMotor1Pin2, HIGH);
  digitalWrite(HardwareConfig::kMotor2Pin1, LOW);
  digitalWrite(HardwareConfig::kMotor2Pin2, HIGH);
}

void stopMotors() {
  digitalWrite(HardwareConfig::kMotor1Pin1, LOW);
  digitalWrite(HardwareConfig::kMotor1Pin2, LOW);
  digitalWrite(HardwareConfig::kMotor2Pin1, LOW);
  digitalWrite(HardwareConfig::kMotor2Pin2, LOW);
}

int driveSecondsFromArgs(JsonVariantConst args) {
  return constrain(static_cast<int>(args["seconds"] | 1), 1, 6);
}

String quoteMoveForward(JsonVariantConst args) {
  return OxBS::usd(driveSecondsFromArgs(args) * 0.01f);
}

bool connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(DeviceConfig::kWifiSsid, DeviceConfig::kWifiPassword);

  const uint32_t deadline = millis() + DeviceConfig::kWifiConnectTimeoutMs;
  while (WiFi.status() != WL_CONNECTED) {
    if (static_cast<int32_t>(deadline - millis()) <= 0) return false;
    delay(250);
  }
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(HardwareConfig::kMotor1Pin1, OUTPUT);
  pinMode(HardwareConfig::kMotor1Pin2, OUTPUT);
  pinMode(HardwareConfig::kMotor2Pin1, OUTPUT);
  pinMode(HardwareConfig::kMotor2Pin2, OUTPUT);
  stopMotors();

  if (!connectWifi()) {
    Serial.println("[app] Wi-Fi failed — check kWifiSsid / kWifiPassword");
    while (true) delay(1000);
  }

  if (!oxbs.wrap(DeviceConfig::kServiceIdMoveForward,
                 [](JsonVariantConst args, JsonObject result) {
                   const int seconds = driveSecondsFromArgs(args);
                   moveForward();
                   oxbs.wait(static_cast<uint32_t>(seconds) * 1000);
                   stopMotors();
                   result["action"] = "forward";
                   result["seconds"] = seconds;
                 })) {
    Serial.println(oxbs.statusMessage());
    while (true) delay(1000);
  }
  if (!oxbs.setPrice(DeviceConfig::kServiceIdMoveForward, quoteMoveForward)) {
    Serial.println(oxbs.statusMessage());
    while (true) delay(1000);
  }

  if (!oxbs.wrap(DeviceConfig::kServiceIdMoveBackward,
                 [](JsonVariantConst args, JsonObject result) {
                   const int seconds = driveSecondsFromArgs(args);
                   moveBackward();
                   oxbs.wait(static_cast<uint32_t>(seconds) * 1000);
                   stopMotors();
                   result["action"] = "backward";
                   result["seconds"] = seconds;
                 })) {
    Serial.println(oxbs.statusMessage());
    while (true) delay(1000);
  }
  if (!oxbs.setPrice(DeviceConfig::kServiceIdMoveBackward, "$0.01")) {
    Serial.println(oxbs.statusMessage());
    while (true) delay(1000);
  }

  OxBSConfig config;
  config.connectorId = DeviceConfig::kConnectorId;
  config.apiKey = DeviceConfig::kApiKey;
  if (!oxbs.begin(config)) {
    Serial.println(oxbs.statusMessage());
    while (true) delay(1000);
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    return;
  }
  oxbs.loop();
}
