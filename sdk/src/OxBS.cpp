#include "OxBS.h"

#include <cctype>
#include <cmath>
#include <cstdarg>
#include <cstring>

static bool isBlank(const char *s) { return s == nullptr || s[0] == '\0'; }

static bool looksLikeUuid(const char *s) {
  if (!s || strlen(s) != 36) return false;
  for (int i = 0; i < 36; i++) {
    const char c = s[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-') return false;
    } else if (!isxdigit(static_cast<unsigned char>(c))) {
      return false;
    }
  }
  return true;
}

static bool isNumericPrice(const String &raw) {
  String t = raw;
  t.trim();
  if (!t.length()) return false;
  if (t.charAt(0) == '$') t.remove(0, 1);
  t.replace(",", "");
  if (!t.length()) return false;
  bool dot = false;
  for (unsigned i = 0; i < t.length(); i++) {
    const char c = t.charAt(i);
    if (c == '.') {
      if (dot) return false;
      dot = true;
      continue;
    }
    if (c < '0' || c > '9') return false;
  }
  return true;
}

static bool isZeroPrice(const String &raw) {
  String t = raw;
  t.trim();
  if (t.charAt(0) == '$') t.remove(0, 1);
  t.replace(",", "");
  if (!t.length()) return true;
  for (unsigned i = 0; i < t.length(); i++) {
    const char c = t.charAt(i);
    if (c != '0' && c != '.') return false;
  }
  return true;
}

OxBS *&OxBS::instance() {
  static OxBS *p = nullptr;
  return p;
}

void OxBS::onMqtt(char *, uint8_t *payload, unsigned int length) {
  if (instance()) instance()->onCommand(payload, length);
}

String OxBS::usd(float amount) {
  if (!isfinite(amount) || amount < 0.0f) amount = 0.0f;
  char buf[16];
  snprintf(buf, sizeof(buf), "$%.2f", amount);
  return String(buf);
}

const char *OxBS::statusToString(OxBSStatus status) {
  switch (status) {
    case OxBSStatus::Ok:
      return "ok";
    case OxBSStatus::NotConfigured:
      return "not configured";
    case OxBSStatus::InvalidArgument:
      return "invalid argument";
    case OxBSStatus::InvalidCredentials:
      return "invalid credentials";
    case OxBSStatus::ServiceTableFull:
      return "service table full";
    case OxBSStatus::WifiDisconnected:
      return "wi-fi disconnected";
    case OxBSStatus::MqttConnectFailed:
      return "mqtt connect failed";
    case OxBSStatus::MqttSubscribeFailed:
      return "mqtt subscribe failed";
    case OxBSStatus::PublishFailed:
      return "mqtt publish failed";
    case OxBSStatus::PayloadTooLarge:
      return "payload too large";
    case OxBSStatus::BadPayload:
      return "bad payload";
    case OxBSStatus::UnknownService:
      return "unknown service";
    case OxBSStatus::ZeroPrice:
      return "price is $0";
    case OxBSStatus::NotStarted:
      return "not started";
    default:
      return "unknown error";
  }
}

const char *OxBS::statusMessage() const {
  static char buf[192];
  if (statusDetail_.length()) {
    snprintf(buf, sizeof(buf), "%s (%s)", statusToString(status_),
             statusDetail_.c_str());
  } else {
    snprintf(buf, sizeof(buf), "%s", statusToString(status_));
  }
  return buf;
}

void OxBS::setLogOutput(Print *out) { log_ = out; }

void OxBS::setStatus(OxBSStatus status, const char *detail) {
  status_ = status;
  statusDetail_ = detail ? detail : "";
  if (status != OxBSStatus::Ok) {
    log("error", statusMessage());
  }
}

void OxBS::log(const char *level, const char *message) {
  if (!log_ || !message) return;
  log_->print("[oxbs] ");
  log_->print(level);
  log_->print(": ");
  log_->println(message);
}

void OxBS::logf(const char *level, const char *fmt, ...) {
  if (!log_ || !fmt) return;
  char buf[192];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  log(level, buf);
}

bool OxBS::storeCredentials(const char *connectorId, const char *apiKey) {
  if (isBlank(connectorId) || isBlank(apiKey)) {
    setStatus(OxBSStatus::InvalidCredentials,
              "connectorId and apiKey are required");
    return false;
  }
  if (!looksLikeUuid(connectorId)) {
    setStatus(OxBSStatus::InvalidCredentials,
              "connectorId must be a UUID from the dashboard");
    return false;
  }
  if (strncmp(apiKey, "bs_", 3) != 0 || strlen(apiKey) < 8) {
    setStatus(OxBSStatus::InvalidCredentials,
              "apiKey must be the bs_… secret shown once at device create");
    return false;
  }
  connectorId_ = connectorId;
  apiKey_ = apiKey;
  cmdTopic_ = String("d/") + connectorId_ + "/cmd";
  replyTopic_ = String("d/") + connectorId_ + "/reply";
  return true;
}

bool OxBS::begin(const char *connectorId, const char *apiKey) {
  OxBSConfig config;
  config.connectorId = connectorId;
  config.apiKey = apiKey;
  return begin(config);
}

bool OxBS::begin(const OxBSConfig &config) {
  instance() = this;
  started_ = false;
  statusDetail_ = "";

  if (WiFi.status() != WL_CONNECTED) {
    setStatus(OxBSStatus::WifiDisconnected,
              "connect Wi-Fi in the sketch before oxbs.begin()");
    return false;
  }

  mqttHost_ = isBlank(config.mqttHost) ? OXBS_DEFAULT_MQTT_HOST : config.mqttHost;
  mqttPort_ = config.mqttPort ? config.mqttPort : OXBS_DEFAULT_MQTT_PORT;
  mqttBufferSize_ = config.mqttBufferSize ? config.mqttBufferSize : 1024;
  keepAliveSec_ = config.keepAliveSec ? config.keepAliveSec : 30;
  mqttRetryMs_ = config.mqttRetryMs ? config.mqttRetryMs : 2000;
  tlsInsecure_ = config.tlsInsecure;

  if (!storeCredentials(config.connectorId, config.apiKey)) return false;

  if (tlsInsecure_) {
    tls_.setInsecure();
  }

  mqtt_.setClient(tls_);
  mqtt_.setServer(mqttHost_.c_str(), mqttPort_);
  mqtt_.setCallback(onMqtt);
  if (!mqtt_.setBufferSize(mqttBufferSize_)) {
    setStatus(OxBSStatus::InvalidArgument, "mqtt buffer allocation failed");
    return false;
  }
  mqtt_.setKeepAlive(keepAliveSec_);

  logf("info", "broker %s:%u  cmd %s", mqttHost_.c_str(), mqttPort_,
       cmdTopic_.c_str());

  if (!connectMqtt(config.mqttConnectTimeoutMs)) return false;

  started_ = true;
  status_ = OxBSStatus::Ok;
  statusDetail_ = "";
  log("info", "connected");
  return true;
}

bool OxBS::requireServiceId(const char *serviceId) {
  if (isBlank(serviceId)) {
    setStatus(OxBSStatus::InvalidArgument, "serviceId is empty");
    return false;
  }
  if (!looksLikeUuid(serviceId)) {
    setStatus(OxBSStatus::InvalidArgument,
              "serviceId must be the service UUID from the dashboard");
    return false;
  }
  return true;
}

OxBS::Slot *OxBS::findSlot(const char *serviceId) {
  if (isBlank(serviceId)) return nullptr;
  for (int i = 0; i < slotCount_; i++) {
    if (slots_[i].id == serviceId) return &slots_[i];
  }
  return nullptr;
}

OxBS::Slot *OxBS::findOrAlloc(const char *serviceId) {
  if (!requireServiceId(serviceId)) return nullptr;
  Slot *existing = findSlot(serviceId);
  if (existing) return existing;
  if (slotCount_ >= OXBS_MAX_SERVICES) {
    setStatus(OxBSStatus::ServiceTableFull, "raise OXBS_MAX_SERVICES");
    return nullptr;
  }
  Slot &slot = slots_[slotCount_++];
  slot = Slot{};
  slot.id = serviceId;
  return &slot;
}

bool OxBS::wrap(const char *serviceId, Handler handler) {
  if (!handler) {
    setStatus(OxBSStatus::InvalidArgument, "handler is null");
    return false;
  }
  Slot *slot = findOrAlloc(serviceId);
  if (!slot) return false;
  slot->handler = handler;
  slot->hasHandler = true;
  status_ = OxBSStatus::Ok;
  logf("info", "wrapped service %s", serviceId);
  return true;
}

bool OxBS::wrap(const char *serviceId, RunFn run) {
  if (!run) {
    setStatus(OxBSStatus::InvalidArgument, "handler is null");
    return false;
  }
  return wrap(serviceId, [run](Args args, Result) { run(args); });
}

bool OxBS::validatePriceString(const String &price, bool warnZero) {
  if (!isNumericPrice(price)) {
    setStatus(OxBSStatus::InvalidArgument,
              "price must be \"$0.01\" or \"0.01\"");
    return false;
  }
  if (warnZero && isZeroPrice(price)) {
    setStatus(OxBSStatus::ZeroPrice, "paid services refuse a $0 quote");
    return false;
  }
  return true;
}

bool OxBS::setPrice(const char *serviceId, PriceFn priceFn) {
  if (!priceFn) {
    setStatus(OxBSStatus::InvalidArgument, "price function is null");
    return false;
  }
  Slot *slot = findOrAlloc(serviceId);
  if (!slot) return false;
  slot->priceFn = priceFn;
  slot->hasDynamicPrice = true;
  slot->hasFixedPrice = false;
  slot->fixedPrice = "";
  status_ = OxBSStatus::Ok;
  logf("info", "dynamic price on %s", serviceId);
  return true;
}

bool OxBS::setPrice(const char *serviceId, const char *fixedPrice) {
  if (isBlank(fixedPrice)) {
    setStatus(OxBSStatus::InvalidArgument, "fixed price is empty");
    return false;
  }
  const String price(fixedPrice);
  if (!validatePriceString(price, true)) return false;
  Slot *slot = findOrAlloc(serviceId);
  if (!slot) return false;
  slot->fixedPrice = price;
  slot->hasFixedPrice = true;
  slot->hasDynamicPrice = false;
  slot->priceFn = nullptr;
  status_ = OxBSStatus::Ok;
  logf("info", "static price %s on %s", price.c_str(), serviceId);
  return true;
}

String OxBS::priceOf(const Slot &slot, Args args) {
  if (slot.hasDynamicPrice && slot.priceFn) {
    String quoted = slot.priceFn(args);
    quoted.trim();
    if (!validatePriceString(quoted, true)) {
      log("error", "price function returned an invalid quote; using $0.01");
      return "$0.01";
    }
    return quoted;
  }
  if (slot.hasFixedPrice && slot.fixedPrice.length()) return slot.fixedPrice;
  log("error", "no price set for service; using $0.01");
  return "$0.01";
}

bool OxBS::publishReply(const char *type, const char *serviceId, const char *reqId,
                        const String &price, JsonDocument *resultSrc) {
  JsonDocument doc;
  doc["type"] = type;
  doc["reqId"] = reqId;
  doc["service_id"] = serviceId;
  doc["api_key"] = apiKey_;
  doc["price"] = price;
  if (resultSrc) {
    JsonObjectConst result = (*resultSrc)["result"];
    if (!result.isNull() && result.size() > 0) {
      doc["result"] = result;
    }
  }
  if (doc.overflowed()) {
    setStatus(OxBSStatus::PayloadTooLarge, "reply JSON overflowed");
    return false;
  }

  char buf[768];
  const size_t n = serializeJson(doc, buf, sizeof(buf));
  if (n == 0 || n >= sizeof(buf) - 1) {
    setStatus(OxBSStatus::PayloadTooLarge, "reply did not fit the publish buffer");
    return false;
  }
  if (!mqtt_.connected()) {
    setStatus(OxBSStatus::MqttConnectFailed, "reply dropped, mqtt down");
    return false;
  }
  if (!mqtt_.publish(replyTopic_.c_str(), reinterpret_cast<const uint8_t *>(buf), n,
                     false)) {
    setStatus(OxBSStatus::PublishFailed, type);
    return false;
  }
  status_ = OxBSStatus::Ok;
  return true;
}

void OxBS::onCommand(uint8_t *payload, unsigned int length) {
  if (!payload || length == 0) {
    setStatus(OxBSStatus::BadPayload, "empty command");
    return;
  }
  if (length >= mqttBufferSize_) {
    setStatus(OxBSStatus::PayloadTooLarge, "command exceeds mqtt buffer");
    return;
  }

  JsonDocument cmd;
  const DeserializationError err = deserializeJson(cmd, payload, length);
  if (err) {
    setStatus(OxBSStatus::BadPayload, err.c_str());
    return;
  }

  const char *type = cmd["type"] | "";
  const char *reqId = cmd["reqId"] | "";
  const char *serviceId = cmd["serviceId"] | "";
  if (isBlank(type) || isBlank(reqId) || isBlank(serviceId)) {
    setStatus(OxBSStatus::BadPayload, "missing type, reqId, or serviceId");
    return;
  }

  Slot *slot = findSlot(serviceId);
  if (!slot) {
    setStatus(OxBSStatus::UnknownService, serviceId);
    return;
  }

  Args args = cmd["params"];
  const String price = priceOf(*slot, args);

  if (!strcmp(type, "GET_QUOTE")) {
    logf("info", "quote %s %s", serviceId, price.c_str());
    publishReply("GET_QUOTE", serviceId, reqId, price, nullptr);
    return;
  }

  if (!strcmp(type, "GET_RESULT")) {
    if (!slot->hasHandler) {
      setStatus(OxBSStatus::NotConfigured, "service has no wrap() handler");
      JsonDocument resultDoc;
      JsonObject result = resultDoc["result"].to<JsonObject>();
      result["error"] = "no handler";
      publishReply("GET_RESULT", serviceId, reqId, price, &resultDoc);
      return;
    }
    logf("info", "run %s", serviceId);
    JsonDocument resultDoc;
    JsonObject result = resultDoc["result"].to<JsonObject>();
    slot->handler(args, result);
    if (resultDoc.overflowed()) {
      setStatus(OxBSStatus::PayloadTooLarge, "handler result overflowed");
    }
    publishReply("GET_RESULT", serviceId, reqId, price, &resultDoc);
    return;
  }

  setStatus(OxBSStatus::BadPayload, type);
}

bool OxBS::tryMqttOnce() {
  if (WiFi.status() != WL_CONNECTED) {
    setStatus(OxBSStatus::WifiDisconnected, nullptr);
    return false;
  }
  logf("info", "mqtt connect as %s", connectorId_.c_str());
  if (!mqtt_.connect(connectorId_.c_str(), connectorId_.c_str(), apiKey_.c_str())) {
    char detail[48];
    snprintf(detail, sizeof(detail), "rc=%d", mqtt_.state());
    setStatus(OxBSStatus::MqttConnectFailed, detail);
    return false;
  }
  if (!mqtt_.subscribe(cmdTopic_.c_str(), 1)) {
    mqtt_.disconnect();
    setStatus(OxBSStatus::MqttSubscribeFailed, cmdTopic_.c_str());
    return false;
  }
  status_ = OxBSStatus::Ok;
  statusDetail_ = "";
  return true;
}

bool OxBS::connectMqtt(uint32_t timeoutMs) {
  const uint32_t start = millis();
  while (!mqtt_.connected()) {
    if (tryMqttOnce()) return true;
    if (timeoutMs > 0 && (millis() - start) >= timeoutMs) {
      return false;
    }
    delay(mqttRetryMs_);
    if (WiFi.status() != WL_CONNECTED) {
      setStatus(OxBSStatus::WifiDisconnected,
                "wi-fi dropped while connecting mqtt");
      return false;
    }
  }
  return true;
}

void OxBS::loop() {
  if (!started_) return;

  if (WiFi.status() != WL_CONNECTED) {
    if (status_ != OxBSStatus::WifiDisconnected) {
      setStatus(OxBSStatus::WifiDisconnected,
                "reconnect Wi-Fi in the sketch, then loop() will resume mqtt");
    }
    return;
  }

  if (!mqtt_.connected()) {
    if (millis() - lastMqttAttemptMs_ < mqttRetryMs_) return;
    lastMqttAttemptMs_ = millis();
    if (tryMqttOnce()) log("info", "mqtt reconnected");
    return;
  }

  mqtt_.loop();
}

void OxBS::wait(uint32_t ms) {
  const unsigned long start = millis();
  while (static_cast<uint32_t>(millis() - start) < ms) {
    if (started_ && mqtt_.connected()) mqtt_.loop();
    delay(10);
  }
}

bool OxBS::connected() { return mqtt_.connected(); }

bool OxBS::ready() {
  return started_ && WiFi.status() == WL_CONNECTED && mqtt_.connected();
}
