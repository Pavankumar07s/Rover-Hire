/**
 * Virtual L298N drive — same MQTT identity as firmware/l298n_drive/l298n_drive.ino.
 * Paste CONNECTOR_ID / API_KEY / service ids into the sketch first (or this
 * will authenticate as the placeholders and the broker will reject it).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import mqtt from "mqtt";

const src = readFileSync(
  new URL("../firmware/l298n_drive/l298n_drive.ino", import.meta.url),
  "utf8",
);
const constant = (name) => {
  const m = src.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  if (!m) throw new Error(`could not read ${name} from the sketch`);
  return m[1];
};

const connectorId = constant("CONNECTOR_ID");
const apiKey = constant("API_KEY");
const forwardId = constant("FORWARD_SERVICE_ID");
const backwardId = constant("BACKWARD_SERVICE_ID");

const url = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const client = mqtt.connect(url, {
  clientId: `${connectorId}.sim`,
  username: connectorId,
  password: apiKey,
  rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED !== "false",
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
    const seconds = cmd.params?.seconds ?? 1;
    let action = "forward";
    if (cmd.serviceId === backwardId || cmd.params?.direction === "backward") {
      action = "backward";
    } else if (cmd.serviceId === forwardId) {
      action = "forward";
    }
    reply.result = { action, seconds, standIn: true };
  }
  client.publish(replyTopic, JSON.stringify(reply), { qos: 1 });
  console.log(`[stand-in] answered ${cmd.type}`);
});

client.on("error", (err) => console.error("[stand-in] error:", err.message));
