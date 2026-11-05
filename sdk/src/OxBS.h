#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <functional>

#ifndef OXBS_MAX_SERVICES
#define OXBS_MAX_SERVICES 8
#endif

#ifndef OXBS_DEFAULT_MQTT_HOST
#define OXBS_DEFAULT_MQTT_HOST "h994eea0.ala.us-east-1.emqxsl.com"
#endif

#ifndef OXBS_DEFAULT_MQTT_PORT
#define OXBS_DEFAULT_MQTT_PORT 8883
#endif

/**
 * Result of the last OxBS operation.
 * begin() / wrap() / setPrice() / loop() update this; read with status().
 */
enum class OxBSStatus : uint8_t {
  Ok = 0,
  NotConfigured,
  InvalidArgument,
  InvalidCredentials,
  ServiceTableFull,
  WifiDisconnected,
  MqttConnectFailed,
  MqttSubscribeFailed,
  PublishFailed,
  PayloadTooLarge,
  BadPayload,
  UnknownService,
  ZeroPrice,
  NotStarted,
};

/** MQTT broker settings. Credentials must outlive OxBS, or pass them into begin(). */
struct OxBSConfig {
  const char *connectorId = nullptr;
  const char *apiKey = nullptr;
  const char *mqttHost = OXBS_DEFAULT_MQTT_HOST;
  uint16_t mqttPort = OXBS_DEFAULT_MQTT_PORT;
  uint16_t mqttBufferSize = 1024;
  uint16_t keepAliveSec = 30;
  uint32_t mqttRetryMs = 2000;
  uint32_t mqttConnectTimeoutMs = 20000;
  bool tlsInsecure = true;
};

/**
 * 0xBS device SDK for ESP32.
 *
 * Wi-Fi is YOUR responsibility. Connect with WiFi.begin() (or SmartConfig,
 * a captive portal, etc.) BEFORE oxbs.begin(). The SDK never calls WiFi.begin().
 *
 *   GET_QUOTE  → price callback only (hardware stays still)
 *   GET_RESULT → wrapped function, then MQTT reply
 */
class OxBS {
public:
  using Args = JsonVariantConst;
  using Result = JsonObject;
  using Handler = std::function<void(Args args, Result result)>;
  using RunFn = std::function<void(Args args)>;
  using PriceFn = std::function<String(Args args)>;

  /** Format a USD amount for the broker, e.g. usd(0.03) → "$0.03". */
  static String usd(float amount);

  static const char *statusToString(OxBSStatus status);

  /**
   * Attach to the broker. Wi-Fi must already be connected.
   * Copies connectorId / apiKey internally.
   */
  bool begin(const OxBSConfig &config);
  bool begin(const char *connectorId, const char *apiKey);

  /** Bind a dashboard service UUID to an existing function. */
  bool wrap(const char *serviceId, Handler handler);
  bool wrap(const char *serviceId, RunFn run);

  /**
   * Dynamic price: invoked with the agent's arguments on GET_QUOTE and GET_RESULT.
   * Return "$0.03", "0.03", or OxBS::usd(0.03). Paid services must quote > $0.
   */
  bool setPrice(const char *serviceId, PriceFn priceFn);

  /** Static price, same quote for every call. */
  bool setPrice(const char *serviceId, const char *fixedPrice);

  /**
   * Call from loop(). Reconnects MQTT if the broker drops.
   * Does not reconnect Wi-Fi — do that in the sketch if needed.
   */
  void loop();

  /** Delay while pumping MQTT. Use inside handlers instead of delay(). */
  void wait(uint32_t ms);

  bool connected();
  bool ready();

  OxBSStatus status() const { return status_; }
  const char *statusMessage() const;

  /** Serial by default. Pass nullptr to disable logs. Never logs the API key. */
  void setLogOutput(Print *out);

private:
  struct Slot {
    String id;
    Handler handler;
    PriceFn priceFn;
    String fixedPrice;
    bool hasHandler = false;
    bool hasDynamicPrice = false;
    bool hasFixedPrice = false;
  };

  static OxBS *&instance();
  static void onMqtt(char *topic, uint8_t *payload, unsigned int length);

  Slot *findSlot(const char *serviceId);
  Slot *findOrAlloc(const char *serviceId);
  bool requireServiceId(const char *serviceId);
  bool storeCredentials(const char *connectorId, const char *apiKey);
  bool validatePriceString(const String &price, bool warnZero);
  String priceOf(const Slot &slot, Args args);
  bool publishReply(const char *type, const char *serviceId, const char *reqId,
                    const String &price, JsonDocument *resultSrc);
  void onCommand(uint8_t *payload, unsigned int length);
  bool connectMqtt(uint32_t timeoutMs);
  bool tryMqttOnce();
  void setStatus(OxBSStatus status, const char *detail = nullptr);
  void log(const char *level, const char *message);
  void logf(const char *level, const char *fmt, ...);

  Slot slots_[OXBS_MAX_SERVICES];
  int slotCount_ = 0;
  bool started_ = false;

  String connectorId_;
  String apiKey_;
  String mqttHost_;
  String cmdTopic_;
  String replyTopic_;
  uint16_t mqttPort_ = OXBS_DEFAULT_MQTT_PORT;
  uint16_t mqttBufferSize_ = 1024;
  uint16_t keepAliveSec_ = 30;
  uint32_t mqttRetryMs_ = 2000;
  bool tlsInsecure_ = true;

  OxBSStatus status_ = OxBSStatus::NotStarted;
  String statusDetail_;
  Print *log_ = &Serial;
  uint32_t lastMqttAttemptMs_ = 0;

  WiFiClientSecure tls_;
  PubSubClient mqtt_;
};
