/**
 * Stands in for the ESP32 while it's offline, using the credentials already in
 * firmware/led_blink/led_blink.ino so the server can't tell the difference.
 * Runs until killed.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import mqtt from "mqtt";

const src = readFileSync(
  new URL("../firmware/led_blink/led_blink.ino", import.meta.url),
  "utf8",
);
const constant = (name) => {
  const m = src.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  if (!m) throw new Error(`could not read ${name} from the sketch`);
  return m[1];
};

const connectorId = constant("CONNECTOR_ID");
const apiKey = constant("API_KEY");

// The device authenticates as its own connectorId, exactly as the firmware does.
const url = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const client = mqtt.connect(url, {
  clientId: `${connectorId}.sim`,
  ...(process.env.MQTT_USERNAME ? { username: process.env.MQTT_USERNAME } : {}),
  ...(process.env.MQTT_PASSWORD ? { password: process.env.MQTT_PASSWORD } : {}),
});
console.log(`[stand-in] broker ${url}`);

const cmdTopic = `d/${connectorId}/cmd`;
const replyTopic = `d/${connectorId}/reply`;

client.on("connect", () => {
  client.subscribe(cmdTopic, { qos: 1 }, (err) => {
    if (err) {
      console.error("[stand-in] subscribe failed:", err.message);
      process.exit(1);
    }
    console.log(`[stand-in] serving ${cmdTopic}`);
  });
});

client.on("message", (_topic, payload) => {
  const cmd = JSON.parse(payload.toString());
  const reply = {
    price: "$0.01",
    type: cmd.type,
    api_key: apiKey,
    service_id: cmd.serviceId,
    reqId: cmd.reqId,
  };
  if (cmd.type === "GET_RESULT") {
    const times = cmd.params?.times ?? 3;
    reply.result = { action: "blink", blinks: times, led: 2, standIn: true };
  }
  client.publish(replyTopic, JSON.stringify(reply), { qos: 1 });
  console.log(`[stand-in] answered ${cmd.type}`);
});

client.on("error", (err) => console.error("[stand-in] error:", err.message));
