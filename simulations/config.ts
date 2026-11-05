import "dotenv/config";
import { readFileSync } from "node:fs";
import type { IClientOptions } from "mqtt";

export const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";

/**
 * Connection options shared by the device sim and the sender.
 *
 * A local EMQX accepts anonymous clients over plain `mqtt://`, so everything
 * here is optional in dev. A hosted broker generally needs all of it: EMQX
 * Cloud Serverless is TLS-only (`mqtts://…:8883`) and rejects anonymous
 * connections, and a real ESP32 would carry the same credentials in firmware.
 */
export function mqttOptions(clientId: string): IClientOptions {
  const options: IClientOptions = { clientId, reconnectPeriod: 2_000 };

  if (process.env.MQTT_USERNAME) options.username = process.env.MQTT_USERNAME;
  if (process.env.MQTT_PASSWORD) options.password = process.env.MQTT_PASSWORD;

  if (/^(mqtts|wss|tls|ssl):/i.test(MQTT_URL)) {
    // Only needed when the broker's certificate isn't publicly rooted.
    const ca = process.env.MQTT_CA_CERT
      ? Buffer.from(process.env.MQTT_CA_CERT.replace(/\\n/g, "\n"), "utf8")
      : process.env.MQTT_CA_PATH
        ? readFileSync(process.env.MQTT_CA_PATH)
        : undefined;
    if (ca) options.ca = ca;
    options.rejectUnauthorized =
      process.env.MQTT_REJECT_UNAUTHORIZED !== "false";
  }

  return options;
}

// PUBLIC device id — shared with agents (appears in the callable URL + public
// discovery). NOT used for MQTT. (Example Sensor Hub / CHANGE_ME)
export const DEVICE_ID =
  process.env.DEVICE_ID ?? "48484243-8d3e-4123-b73d-7c9860f72529";

// PRIVATE connector id — the MQTT transport identity. The real device flashes
// THIS into firmware; it must never be shared. All d/<connectorId>/… topics use
// it. Set to the device's connectorId (from the dashboard / GET /devices/:id).
export const CONNECTOR_ID = process.env.CONNECTOR_ID ?? "";

// The device's raw API key — sent back on each reply so the server can verify
// it (hash-and-compare).
export const API_KEY = process.env.API_KEY ?? "";

// A default serviceId (only used by the standalone agent.ts). The ESP sim
// echoes back whichever serviceId the incoming command asked for, so it serves
// ALL of the device's services, not just this one.
export const SERVICE_ID =
  process.env.SERVICE_ID ?? "24292965-b277-491d-b8ea-102049c71c09";

export const topics = {
  cmd: (connectorId: string) => `d/${connectorId}/cmd`,
  reply: (connectorId: string) => `d/${connectorId}/reply`,
  status: (connectorId: string) => `d/${connectorId}/status`,
};
