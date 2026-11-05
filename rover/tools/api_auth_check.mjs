// Laptop-side P2 check: every rover route answers 401 without the token or with a wrong one.
// Usage: node rover/tools/api_auth_check.mjs [host] [out.json]   (token from ~/.0xbs/rover_lan_token)
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const host = process.argv[2] ?? "rovera.local:8700";
const token = readFileSync(`${homedir()}/.0xbs/rover_lan_token`, "utf8").trim();
const routes = [
  ["GET", "/status"], ["GET", "/frame"], ["GET", "/photo/1"], ["GET", "/telemetry"], ["POST", "/mission/start"],
  ["POST", "/mission/end"], ["POST", "/money"], ["POST", "/money/hb"], ["POST", "/test/duty"], ["GET", "/nope"],
];
const variants = { none: {}, wrong: { "X-Rover-Token": "x".repeat(token.length) }, prefix: { "X-Rover-Token": token.slice(0, -1) } };

const results = [];
for (const [method, path] of routes) {
  for (const [name, headers] of Object.entries(variants)) {
    const body = method === "POST" ? JSON.stringify({ l: 40, r: 40, lease_ms: 1500 }) : undefined;
    const res = await fetch(`http://${host}${path}`, { method, headers: { ...headers, "Content-Type": "application/json" }, body });
    results.push({ method, path, token: name, status: res.status });
  }
}
const good = await fetch(`http://${host}/status`, { headers: { "X-Rover-Token": token } });
const result = {
  at: new Date().toISOString(),
  host,
  with_token_status: good.status,
  pass: results.every((r) => r.status === 401) && good.status === 200,
  results,
};
console.log(JSON.stringify(result, null, 1));
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(result, null, 1));
