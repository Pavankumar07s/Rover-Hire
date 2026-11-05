import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import { topics } from "../config.js";
import { apiKeyMatches } from "./api-key.js";

const MQTT_URL = process.env.MQTT_URL;
if (!MQTT_URL) throw new Error("MQTT_URL is not configured");

const REPLY_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 5_000;
const SUB_IDLE_MS = 60_000;
const ONLINE_WINDOW_MS = 90_000;

type CommandType = "GET_QUOTE" | "GET_RESULT";

type Pending = {
  replyTopic: string;
  type: CommandType;
  serviceId: string;
  apiKeyHash?: string | undefined;
  settle: (err: Error | null, data?: any) => void;
};

const pending = new Map<string, Pending>();
const inFlight = new Map<string, number>();
const held = new Set<string>();
const idleTimers = new Map<string, NodeJS.Timeout>();
const lastSeenMs = new Map<string, number>();

let client: MqttClient | undefined;

function loadCa(): Buffer | undefined {
  const inline = process.env.MQTT_CA_CERT;
  if (inline) return Buffer.from(inline.replace(/\\n/g, "\n"), "utf8");
  const path = process.env.MQTT_CA_PATH;
  return path ? readFileSync(path) : undefined;
}

function redact(url: string): string {
  return url.replace(/\/\/[^@/]*@/, "//***@");
}

function redactPayload(body: string): string {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    if (data && typeof data === "object" && "api_key" in data) {
      data.api_key = "[redacted]";
    }
    return JSON.stringify(data);
  } catch {
    return "[unparseable]";
  }
}

export function getMqttClient(): MqttClient {
  if (client) return client;

  const options: IClientOptions = {
    clientId: `srv-${randomBytes(6).toString("hex")}`,
    clean: true,
    reconnectPeriod: 2_000,
    connectTimeout: 10_000,
    keepalive: 30,
    resubscribe: false,
  };

  if (process.env.MQTT_USERNAME) options.username = process.env.MQTT_USERNAME;
  if (process.env.MQTT_PASSWORD) options.password = process.env.MQTT_PASSWORD;

  if (/^(mqtts|wss|tls|ssl):/i.test(MQTT_URL!)) {
    const ca = loadCa();
    if (ca) options.ca = ca;
    options.rejectUnauthorized =
      process.env.MQTT_REJECT_UNAUTHORIZED !== "false";
  }

  const c = mqtt.connect(MQTT_URL!, options);

  c.on("connect", () => {
    console.log(`[mqtt] connected to ${redact(MQTT_URL!)}`);
    for (const topic of held) {
      c.subscribe(topic, { qos: 1 }, (err) => {
        if (err) console.error(`[mqtt] resubscribe "${topic}":`, err.message);
      });
    }
  });

  c.on("error", (err) => console.error("[mqtt] error:", err.message));
  c.on("close", () => console.warn("[mqtt] disconnected, retrying…"));
  c.on("message", handleMessage);

  client = c;
  return c;
}

function handleMessage(topic: string, payload: Buffer): void {
  const body = payload.toString();
  console.log(`📩 on "${topic}":`, redactPayload(body));

  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    // One corrupt frame must not abort every in-flight waiter on this topic.
    console.warn(`[mqtt] ignoring unparseable payload on "${topic}"`);
    return;
  }

  const waiter =
    typeof data?.reqId === "string" ? pending.get(data.reqId) : undefined;

  if (!waiter || waiter.replyTopic !== topic || data.type !== waiter.type) {
    return;
  }

  if (waiter.apiKeyHash) {
    const replyKey = data.api_key;
    if (typeof replyKey !== "string" || !apiKeyMatches(replyKey, waiter.apiKeyHash)) {
      waiter.settle(new Error("Device authentication failed: invalid API key"));
      return;
    }
  }

  if (data.service_id !== waiter.serviceId) {
    waiter.settle(new Error("Device reply service_id mismatch"));
    return;
  }

  const connectorId = topic.split("/")[1];
  if (connectorId) lastSeenMs.set(connectorId, Date.now());

  waiter.settle(null, data);
}

/** True if this connector replied within ONLINE_WINDOW_MS. */
export function recentlySeen(connectorId: string): boolean {
  const at = lastSeenMs.get(connectorId);
  return at != null && Date.now() - at < ONLINE_WINDOW_MS;
}

async function ready(c: MqttClient): Promise<void> {
  if (c.connected) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      c.removeListener("connect", onConnect);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("MQTT broker is unreachable"));
    }, CONNECT_TIMEOUT_MS);
    if (c.connected) {
      cleanup();
      resolve();
      return;
    }
    c.on("connect", onConnect);
  });
}

async function acquire(topic: string, c: MqttClient): Promise<void> {
  const count = inFlight.get(topic) ?? 0;
  inFlight.set(topic, count + 1);
  const idle = idleTimers.get(topic);
  if (idle) {
    clearTimeout(idle);
    idleTimers.delete(topic);
  }
  if (held.has(topic)) return;

  await new Promise<void>((resolve, reject) => {
    c.subscribe(topic, { qos: 1 }, (err) =>
      err ? reject(new Error(`Subscribe failed: ${err.message}`)) : resolve(),
    );
  });
  held.add(topic);
}

function release(topic: string, c: MqttClient): void {
  const count = inFlight.get(topic) ?? 0;
  if (count > 1) {
    inFlight.set(topic, count - 1);
    return;
  }
  inFlight.delete(topic);
  const existing = idleTimers.get(topic);
  if (existing) clearTimeout(existing);
  idleTimers.set(
    topic,
    setTimeout(() => {
      idleTimers.delete(topic);
      held.delete(topic);
      c.unsubscribe(topic, (err) => {
        if (err) console.error(`[mqtt] unsubscribe "${topic}":`, err.message);
      });
    }, SUB_IDLE_MS),
  );
}

export async function callDevice(
  type: CommandType,
  connectorId: string,
  serviceId: string,
  params: {},
  apiKeyHash?: string,
): Promise<any> {
  const c = getMqttClient();
  await ready(c);

  const replyTopic = topics.reply(connectorId);
  const reqId = randomBytes(6).toString("hex");

  try {
    await acquire(replyTopic, c);
  } catch (err) {
    release(replyTopic, c);
    throw err;
  }

  try {
    return await new Promise<any>((resolve, reject) => {
      let timer: NodeJS.Timeout;
      let settled = false;

      const settle = (err: Error | null, data?: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(data);
      };

      timer = setTimeout(
        () => settle(new Error("Timed out waiting for device reply (10s)")),
        REPLY_TIMEOUT_MS,
      );

      pending.set(reqId, {
        replyTopic,
        type,
        serviceId,
        apiKeyHash,
        settle,
      });

      const command = { type, reqId, serviceId, params };
      c.publish(
        topics.cmd(connectorId),
        JSON.stringify(command),
        { qos: 1 },
        (err) => {
          if (err) settle(new Error(`Publish failed: ${err.message}`));
          else console.log("[mqtt] ✅ sent:", command);
        },
      );
    });
  } finally {
    pending.delete(reqId);
    release(replyTopic, c);
  }
}
