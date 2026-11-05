/**
 * SENDER — pretends to be your server sending a command to a device.
 *
 * Run this in a second terminal (while the listener is running):  pnpm send
 *
 * It connects to EMQX, publishes one command to `d/<deviceId>/cmd`, and exits.
 * The listener terminal should instantly print the message — proving the
 * message travelled: server → EMQX → device.
 */
import mqtt from "mqtt";
import { MQTT_URL, DEVICE_ID, topics, mqttOptions } from "./config.js";

const topic = topics.cmd(DEVICE_ID);

// A fake command, like "read the temperature sensor", with a job id.
const command = {
  reqId: Math.random().toString(16).slice(2, 10),
  action: "read-temp",
  params: {},
};

console.log(`[sender] connecting to ${MQTT_URL} ...`);
const client = mqtt.connect(
  MQTT_URL,
  mqttOptions(`sender-${Math.random().toString(16).slice(2, 8)}`),
);

client.on("connect", () => {
  console.log(`[sender] connected. publishing to "${topic}"`);
  client.publish(topic, JSON.stringify(command), { qos: 1 }, (err) => {
    if (err) console.error("[sender] publish failed:", err.message);
    else console.log("[sender] ✅ sent:", command);
    client.end();
  });
});

client.on("error", (err) => console.error("[sender] error:", err.message));
