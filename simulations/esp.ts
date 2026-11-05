import "dotenv/config";
import mqtt from "mqtt";
import {
  MQTT_URL,
  CONNECTOR_ID,
  topics,
  API_KEY,
  SERVICE_ID,
  mqttOptions,
} from "./config.js";

// The device talks to the broker over its PRIVATE connector id, never the
// public device id. clientId == connectorId so EMQX presence maps 1:1.
const topic = topics.cmd(CONNECTOR_ID);
const reply_topic = topics.reply(CONNECTOR_ID);

console.log(`[listener] connecting to ${MQTT_URL} ...`);
// Simulators must not reuse the board's clientId — EMQX kicks the older session.
const mqttClientId = `${CONNECTOR_ID}.sim`;
const client = mqtt.connect(MQTT_URL, mqttOptions(mqttClientId));

client.on("connect", () => {
  console.log(`[listener] connected. subscribing to "${topic}"`);
  client.subscribe(topic, (err) => {
    if (err) {
      console.error("[listener] subscribe failed:", err.message);
      process.exit(1);
    }
    console.log(
      `[listener] waiting for messages on "${topic}" ... (Ctrl+C to stop)`,
    );
  });
});

// Fake per-service work. Echo back the serviceId the server asked for (the
// controller checks reply.service_id === requested serviceId), so this one
// device serves ALL of its services. `params` come straight from the agent.
function computeResult(serviceId: string, params: Record<string, unknown> = {}) {
  const room = params.room ?? "?";
  const floor = params.floor ?? "?";
  return {
    serviceId,
    // A little deterministic-ish demo payload per call.
    reading: {
      temperatureC: 21.4,
      humidityPct: 47,
      status: "online",
      uptimeSec: Math.floor(process.uptime()),
      room,
      floor,
    },
    ts: new Date().toISOString(),
  };
}

client.on("message", (t, payload) => {
  console.log(`\n[listener] 📩 message on "${t}":`);
  const server_command = JSON.parse(payload.toString());
  console.log("           ", server_command);

  // Serve whatever service the command targeted, falling back to the config
  // default only if the server didn't send one.
  const serviceId: string = server_command.serviceId ?? SERVICE_ID;
  const params = (server_command.params ?? {}) as Record<string, unknown>;

  if (server_command.type == "GET_QUOTE") {
    const response = {
      price: "$0.01",
      type: "GET_QUOTE",
      api_key: API_KEY,
      service_id: serviceId,
      reqId: server_command.reqId,
    };
    client.publish(reply_topic, JSON.stringify(response), { qos: 1 }, (err) => {
      if (err) console.error("[sender] publish failed:", err.message);
      else console.log("[sender] ✅ sent:", response);
    });
  }
  if (server_command.type == "GET_RESULT") {
    const response = {
      price: "$0.01",
      type: "GET_RESULT",
      api_key: API_KEY,
      service_id: serviceId,
      reqId: server_command.reqId,
      result: computeResult(serviceId, params),
    };
    client.publish(reply_topic, JSON.stringify(response), { qos: 1 }, (err) => {
      if (err) console.error("[sender] publish failed:", err.message);
      else console.log("[sender] ✅ sent:", response);
    });
  }
});

client.on("error", (err) => console.error("[listener] error:", err.message));
