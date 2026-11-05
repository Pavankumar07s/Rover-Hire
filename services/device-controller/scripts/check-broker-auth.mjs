// Tries an MQTT login with each connectorId:apiKey pair and reports whether the broker accepts it.
// Usage: BROKER_URL=mqtts://host:8883 CREDS="connector:key,connector:key" node scripts/check-broker-auth.mjs [--json out.json]
import { writeFileSync } from "node:fs";
import mqtt from "mqtt";

const url = process.env.BROKER_URL;
const pairs = (process.env.CREDS ?? "").split(",").filter(Boolean).map((p) => p.split(":"));
if (!url || pairs.length === 0) {
  console.error("Set BROKER_URL and CREDS");
  process.exit(2);
}

function tryLogin(connectorId, key) {
  return new Promise((resolve) => {
    // Distinct clientId so a live device session is never kicked.
    const c = mqtt.connect(url, {
      clientId: `${connectorId}.authcheck`,
      username: connectorId,
      password: key,
      reconnectPeriod: 0,
      connectTimeout: 10_000,
      rejectUnauthorized: true,
    });
    const done = (result, detail) => {
      c.end(true);
      resolve({ connector: `${connectorId.slice(0, 8)}…`, result, detail });
    };
    c.once("connect", () => done("ACCEPTED", "connack 0"));
    c.once("error", (err) => done("REFUSED", err.message));
    c.once("close", () => done("REFUSED", "closed before connack"));
  });
}

const results = [];
for (const [connectorId, key] of pairs) results.push(await tryLogin(connectorId, key));
for (const r of results) console.log(`${r.result.padEnd(8)} ${r.connector}  ${r.detail}`);

const out = process.argv.indexOf("--json");
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify({ at: new Date().toISOString(), url, results }, null, 1));
