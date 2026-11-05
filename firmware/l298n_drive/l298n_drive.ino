// 0xBS L298N car — original motor functions, new OxBS SDK.
// Public device id: be0ef5c7-1977-4247-bea7-75d065d0a6c9
// Connect Wi-Fi here; the SDK never calls WiFi.begin().
#include <WiFi.h>
#include "OxBS.h"

const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char *CONNECTOR_ID = "YOUR_CONNECTOR_ID";
const char *API_KEY = "YOUR_API_KEY";
const char *FORWARD_SERVICE_ID = "413b6d54-a225-4517-912b-c539d23d1f5a";
const char *BACKWARD_SERVICE_ID = "0c232cf5-22ec-4ea9-8a66-23d3899a7a31";

const int motor1Pin1 = 12; // IN1
const int motor1Pin2 = 13; // IN2
const int motor2Pin1 = 14; // IN3
const int motor2Pin2 = 27; // IN4

OxBS oxbs;

void moveForward() {
  digitalWrite(motor1Pin1, HIGH);
  digitalWrite(motor1Pin2, LOW);
  digitalWrite(motor2Pin1, HIGH);
  digitalWrite(motor2Pin2, LOW);
}

void moveBackward() {
  digitalWrite(motor1Pin1, LOW);
  digitalWrite(motor1Pin2, HIGH);
  digitalWrite(motor2Pin1, LOW);
  digitalWrite(motor2Pin2, HIGH);
}

void stopMotors() {
  digitalWrite(motor1Pin1, LOW);
  digitalWrite(motor1Pin2, LOW);
  digitalWrite(motor2Pin1, LOW);
  digitalWrite(motor2Pin2, LOW);
}

int driveSeconds(JsonVariantConst args) {
  return constrain(static_cast<int>(args["seconds"] | 1), 1, 6);
}

String priceForward(JsonVariantConst args) {
  return OxBS::usd(driveSeconds(args) * 0.01f);
}

void setup() {
  Serial.begin(115200);
  pinMode(motor1Pin1, OUTPUT);
  pinMode(motor1Pin2, OUTPUT);
  pinMode(motor2Pin1, OUTPUT);
  pinMode(motor2Pin2, OUTPUT);
  stopMotors();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(250);

  oxbs.wrap(FORWARD_SERVICE_ID, [](JsonVariantConst args, JsonObject result) {
    int seconds = driveSeconds(args);
    moveForward();
    oxbs.wait(seconds * 1000);
    stopMotors();
    result["action"] = "forward";
    result["seconds"] = seconds;
  });
  oxbs.setPrice(FORWARD_SERVICE_ID, priceForward);

  oxbs.wrap(BACKWARD_SERVICE_ID, [](JsonVariantConst args, JsonObject result) {
    int seconds = driveSeconds(args);
    moveBackward();
    oxbs.wait(seconds * 1000);
    stopMotors();
    result["action"] = "backward";
    result["seconds"] = seconds;
  });
  oxbs.setPrice(BACKWARD_SERVICE_ID, "$0.01");

  OxBSConfig config;
  config.connectorId = CONNECTOR_ID;
  config.apiKey = API_KEY;
  if (!oxbs.begin(config)) {
    Serial.println(oxbs.statusMessage());
    while (true) delay(1000);
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    delay(250);
    return;
  }
  oxbs.loop();
}
