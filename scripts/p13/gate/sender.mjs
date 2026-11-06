// Phase 13 go/no-go gate, cloud side: sends the money-style heartbeat (every 250 ms, 1 s timeout, not awaited, like
// services/hedera-shop) to the rover's tunnel and measures each reply. Node standard library only.
//   TARGET_URL=https://<tunnel> GATE_TOKEN=... PORT=10000 node sender.mjs
import http from "node:http";

const { TARGET_URL, GATE_TOKEN } = process.env;
const PORT = Number(process.env.PORT ?? 10000);
const PERIOD_MS = 250;
let run = null;

function start(minutes) {
  run = { started: Date.now(), until: Date.now() + minutes * 60_000, seq: 0, sent: 0, ok: 0, failed: 0, rtts: [], errors: {} };
  const r = run;
  const timer = setInterval(() => {
    if (Date.now() > r.until) return clearInterval(timer);
    const seq = r.seq++, t0 = performance.now();
    r.sent++;
    fetch(`${TARGET_URL}/hb`, { method: "POST", headers: { "Content-Type": "application/json", "X-Gate-Token": GATE_TOKEN },
      body: JSON.stringify({ seq, sent_ms: Date.now() }), signal: AbortSignal.timeout(1000) })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); r.ok++; r.rtts.push(Math.round(performance.now() - t0)); })
      .catch((e) => { r.failed++; const k = e.name === "TimeoutError" ? "timeout" : e.message; r.errors[k] = (r.errors[k] ?? 0) + 1; });
  }, PERIOD_MS);
}

function stats() {
  if (!run) return { running: false };
  const s = [...run.rtts].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { running: Date.now() < run.until, seconds: Math.round((Math.min(Date.now(), run.until) - run.started) / 1000),
    sent: run.sent, ok: run.ok, failed: run.failed, errors: run.errors,
    rtt_ms: s.length ? { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.at(-1) } : null };
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/health") return send(200, { ok: true });
  if (url.searchParams.get("key") !== GATE_TOKEN) return send(403, { ok: false });
  if (url.pathname === "/run") { start(Math.min(30, Math.max(1, Number(url.searchParams.get("minutes") ?? 10)))); return send(200, { started: true }); }
  if (url.pathname === "/stats") return send(200, stats());
  send(404, { ok: false });
}).listen(PORT, () => console.log(`gate sender on :${PORT} -> ${TARGET_URL}`));
