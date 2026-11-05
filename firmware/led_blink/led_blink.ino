// 0xBS — onboard LED. ArduinoJson v7 + PubSubClient.
// Cloud EMQX: TLS, no CA. Stop tmp-standin.mjs before flashing.
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char *MQTT_HOST = "h994eea0.ala.us-east-1.emqxsl.com";
const uint16_t MQTT_PORT = 8883;
const char *CONNECTOR_ID = "YOUR_CONNECTOR_ID";
const char *API_KEY = "YOUR_API_KEY";
const int LED = 2;  // ESP32 DevKit onboard LED. C3: use 8.

WiFiClientSecure tls;
PubSubClient mqtt(tls);
String cmdTopic, replyTopic;

void blink(int n, int onMs, int offMs) {
  for (int i = 0; i < n; i++) {
    digitalWrite(LED, HIGH);
    delay(onMs);
    mqtt.loop();
    digitalWrite(LED, LOW);
    delay(offMs);
    mqtt.loop();
  }
}

void reply(const char *type, const char *serviceId, const char *reqId, int blinks) {
  JsonDocument doc;
  doc["type"] = type;
  doc["reqId"] = reqId;
  doc["service_id"] = serviceId;
  doc["api_key"] = API_KEY;
  doc["price"] = "$0.01";
  if (blinks) {
    doc["result"]["action"] = "blink";
    doc["result"]["blinks"] = blinks;
    doc["result"]["led"] = LED;
  }
  char buf[512];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(replyTopic.c_str(), (uint8_t *)buf, n, false);
}

void onMessage(char *, uint8_t *payload, unsigned int length) {
  JsonDocument cmd;
  if (deserializeJson(cmd, payload, length)) return;
  const char *type = cmd["type"] | "";
  const char *reqId = cmd["reqId"] | "";
  const char *serviceId = cmd["serviceId"] | "";
  if (!type[0] || !reqId[0] || !serviceId[0]) return;

  if (!strcmp(type, "GET_QUOTE")) {
    reply("GET_QUOTE", serviceId, reqId, 0);
    return;
  }
  if (!strcmp(type, "GET_RESULT")) {
    int times = constrain((int)(cmd["params"]["times"] | 3), 1, 10);
    int onMs = constrain((int)(cmd["params"]["onMs"] | 150), 20, 400);
    int offMs = constrain((int)(cmd["params"]["offMs"] | 150), 20, 400);
    blink(times, onMs, offMs);
    reply("GET_RESULT", serviceId, reqId, times);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
  blink(3, 80, 80);

  cmdTopic = String("d/") + CONNECTOR_ID + "/cmd";
  replyTopic = String("d/") + CONNECTOR_ID + "/reply";

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(400);

  tls.setInsecure();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(1024);
  mqtt.setKeepAlive(30);

  while (!mqtt.connected()) {
    if (mqtt.connect(CONNECTOR_ID, CONNECTOR_ID, API_KEY)) {
      mqtt.subscribe(cmdTopic.c_str(), 1);
      blink(2, 60, 60);
    } else {
      delay(2000);
    }
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) WiFi.begin(WIFI_SSID, WIFI_PASS);
  if (!mqtt.connected()) {
    if (mqtt.connect(CONNECTOR_ID, CONNECTOR_ID, API_KEY)) mqtt.subscribe(cmdTopic.c_str(), 1);
    else delay(2000);
  }
  mqtt.loop();
}
