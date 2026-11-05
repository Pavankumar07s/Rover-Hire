/*
 * OxBS — WrapService
 *
 * Connect Wi-Fi in this sketch (the SDK does not). Then wrap two existing
 * functions: one with a static price, one with a price derived from arguments.
 *
 * Board: ESP32
 * Libraries: OxBS, PubSubClient, ArduinoJson v7
 *
 * Dashboard: https://app.0xbs.org  → device connectorId, apiKey (once),
 * and two service UUIDs.
 */

#include <WiFi.h>
#include <OxBS.h>

namespace DeviceConfig {
  constexpr const char *kWifiSsid = "YOUR_WIFI_SSID";
  constexpr const char *kWifiPassword = "YOUR_WIFI_PASSWORD";

  constexpr const char *kConnectorId = "YOUR_CONNECTOR_ID";
  constexpr const char *kApiKey = "YOUR_API_KEY";

  constexpr const char *kServiceIdBlinkStatic = "YOUR_STATIC_PRICE_SERVICE_ID";
  constexpr const char *kServiceIdBlinkDynamic = "YOUR_DYNAMIC_PRICE_SERVICE_ID";

  constexpr uint32_t kWifiConnectTimeoutMs = 30000;
}

namespace HardwareConfig {
  constexpr int kLedGpio = 2;  // ESP32-C3: 8
}

OxBS oxbs;

void blinkOnce() {
  digitalWrite(HardwareConfig::kLedGpio, HIGH);
  oxbs.wait(200);
  digitalWrite(HardwareConfig::kLedGpio, LOW);
  oxbs.wait(80);
}

int blinkCountFromArgs(JsonVariantConst args) {
  return constrain(static_cast<int>(args["times"] | 1), 1, 10);
}

String quoteBlinkDynamic(JsonVariantConst args) {
  return OxBS::usd(blinkCountFromArgs(args) * 0.01f);
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
  pinMode(HardwareConfig::kLedGpio, OUTPUT);
  digitalWrite(HardwareConfig::kLedGpio, LOW);

  if (!connectWifi()) {
    Serial.println("[app] Wi-Fi failed — check kWifiSsid / kWifiPassword");
    while (true) delay(1000);
  }
  Serial.print("[app] Wi-Fi ");
  Serial.println(WiFi.localIP());

  if (!oxbs.wrap(DeviceConfig::kServiceIdBlinkStatic,
                 [](JsonVariantConst, JsonObject result) {
                   blinkOnce();
                   result["action"] = "blink";
                   result["blinks"] = 1;
                 })) {
    Serial.println(oxbs.statusMessage());
    while (true) delay(1000);
  }
  if (!oxbs.setPrice(DeviceConfig::kServiceIdBlinkStatic, "$0.01")) {
    Serial.println(oxbs.statusMessage());
    while (true) delay(1000);
  }

  if (!oxbs.wrap(DeviceConfig::kServiceIdBlinkDynamic,
                 [](JsonVariantConst args, JsonObject result) {
                   const int times = blinkCountFromArgs(args);
                   for (int i = 0; i < times; i++) blinkOnce();
                   result["action"] = "blink";
                   result["blinks"] = times;
                 })) {
    Serial.println(oxbs.statusMessage());
    while (true) delay(1000);
  }
  if (!oxbs.setPrice(DeviceConfig::kServiceIdBlinkDynamic, quoteBlinkDynamic)) {
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
