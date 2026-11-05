// Laptop-side check of the rover's /telemetry rate, camera frame rate and frame brightness.
// Usage: node rover/tools/telemetry_check.mjs <seconds> [host]   (token from ~/.0xbs/rover_lan_token)
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const seconds = Number(process.argv[2] ?? 60);
const host = process.argv[3] ?? "rovera.local:8700";
const token = readFileSync(`${homedir()}/.0xbs/rover_lan_token`, "utf8").trim();
const headers = { "X-Rover-Token": token };

const status = async () => (await fetch(`http://${host}/status`, { headers })).json();

const s0 = await status();
const t0 = performance.now();
const gaps = [];
let count = 0;
let last = null;

const ws = new WebSocket(`ws://${host}/telemetry`, { headers });
ws.onmessage = () => {
  const now = performance.now();
  if (last !== null) gaps.push(now - last);
  last = now;
  count += 1;
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const lumas = [];
const sampler = setInterval(async () => lumas.push((await status()).camera.luma), 5000);
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
clearInterval(sampler);
ws.close();
const s1 = await status();
const elapsed = (performance.now() - t0) / 1000;

gaps.sort((a, b) => a - b);
const pct = (p) => Math.round(gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))]);
const result = {
  at: new Date().toISOString(),
  seconds: Math.round(elapsed),
  telemetry_hz: +(count / elapsed).toFixed(2),
  gap_ms: { p50: pct(0.5), p99: pct(0.99), max: Math.round(gaps.at(-1)) },
  camera_fps: +((s1.camera.frame_seq - s0.camera.frame_seq) / elapsed).toFixed(2),
  camera_read_failures: s1.camera.read_failures - s0.camera.read_failures,
  camera_opens: s1.camera.opens,
  luma: lumas.length ? { samples: lumas.length, min: Math.min(...lumas), max: Math.max(...lumas) } : null,
  mcu_connected: s1.mcu_connected,
  pass: Math.abs(count / elapsed - 20) <= 1 && (s1.camera.frame_seq - s0.camera.frame_seq) / elapsed >= 25,
};
console.log(JSON.stringify(result, null, 1));
if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(result, null, 1));
