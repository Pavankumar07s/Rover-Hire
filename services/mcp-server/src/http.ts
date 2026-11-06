// Phase 13 hybrid: the rover tools over Streamable HTTP, for remote MCP clients (Claude custom connectors and others).
// The shop, zg-log and the rover stay on the laptop; their localhost addresses are sent through the laptop's tunnel
// (p13-edge), set by the owner with scripts/p13/mode.sh. Served: the five rover tools (hedera_wallet_info shows the remote buyer)
// and, since Phase 14, the three Station-A tools, paid on Hedera, Base Sepolia or Solana devnet from the remote buyer's wallets.
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import { afterDurableWrite } from "./hedera/durable.js";
import { openStore, type Store } from "./p13/store.js";

const env = process.env;
const need = (k: string) => {
  const v = env[k]?.trim();
  if (!v || v.length < 24) throw new Error(`${k} is missing or shorter than 24 characters`);
  return v;
};
const PORT = Number(env.PORT ?? 10000);
const EDGE_KEY = need("P13_EDGE_KEY");
const OWNER_KEY = need("P13_OWNER_KEY");
const USER_KEYS = (env.P13_MCP_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  .map((s) => ({ label: s.slice(0, s.indexOf(":")), key: s.slice(s.indexOf(":") + 1) })).filter((u) => u.label && u.key.length >= 24);
if (!USER_KEYS.length) throw new Error("P13_MCP_KEYS needs at least one label:key (key at least 24 characters)");
const DAILY_CAP = Math.round(Number(env.P13_DAILY_CAP_USDC ?? "2.00") * 1e6); // atomic USDC, all users together

let tunnel: string | null = null; // the laptop tunnel's address while remote access is on

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// The shop, the Rover-B sim and zg-log as the stable setup names them, and where they are reached through p13-edge.
const LOCAL: [string, string][] = [["http://localhost:8402", "/rover-a"], ["http://localhost:8403", "/rover-b"],
  ["http://localhost:8787", "/zg"], ["http://localhost:8404", "/station-a"], ["http://127.0.0.1:8402", "/rover-a"],
  ["http://127.0.0.1:8403", "/rover-b"], ["http://127.0.0.1:8787", "/zg"], ["http://127.0.0.1:8404", "/station-a"]];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  const hit = LOCAL.find(([from]) => url === from || url.startsWith(from + "/") || url.startsWith(from + "?"));
  if (!hit) return realFetch(input, init);
  if (!tunnel) throw new Error("rover offline: the owner switched remote access off");
  const to = tunnel + hit[1] + url.slice(hit[0].length);
  if (input instanceof Request) {
    const r = new Request(to, input);
    r.headers.set("x-p13-edge-key", EDGE_KEY);
    return realFetch(r, init);
  }
  const headers = new Headers(init?.headers);
  headers.set("x-p13-edge-key", EDGE_KEY);
  return realFetch(to, { ...init, headers });
}) as typeof fetch;

// After the fetch patch: the buyer builds its paying fetch from the global one when a mission starts.
const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { registerHederaTools, setSpendGuard, capUsedOn, MISSIONS_DIR } = await import("./hedera/tools.js");
const { registerSensorTools } = await import("./hedera/sensors.js");

const today = () => new Date().toISOString().slice(0, 10);
// Station-A buys count against the same daily cap (Phase 14); the day's total is kept in Postgres when the copy is on.
let sensorSpend = { day: today(), atomic: 0 };
const sensorToday = () => (sensorSpend.day === today() ? sensorSpend.atomic : 0);
// Running missions hold their whole budget; finished ones only what they spent (tools.ts capUsedOn).
setSpendGuard((budget) => {
  const used = Number(capUsedOn(today())) + sensorToday();
  if (used + Number(budget) > DAILY_CAP)
    return `This server's daily cap is ${DAILY_CAP / 1e6} USDC for all users together; ${(used / 1e6).toFixed(3)} is already spent or held by a running mission today.`;
  return null;
});

/** A saved tunnel address counts only if the laptop's edge still answers through it. */
async function liveTunnel(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    if ((await realFetch(`${url}/edge/health`, { signal: AbortSignal.timeout(10_000) })).ok) return url;
  } catch { /* the tunnel is gone */ }
  console.error(`[rover-for-hire] the saved tunnel no longer answers; remote access stays off until mode.sh hybrid`);
  return null;
}

// The laptop can vanish without saying so (reboot, crash, lost Wi-Fi): a tunnel that stops answering 3 checks in a row,
// a minute apart, is dropped, so remote users see "rover offline" instead of a dead tunnel.
let misses = 0;
setInterval(async () => {
  if (!tunnel) return void (misses = 0);
  const t = tunnel;
  const ok = await realFetch(`${t}/edge/health`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok).catch(() => false);
  if (tunnel !== t) return;
  misses = ok ? 0 : misses + 1;
  if (misses < 3) return;
  console.error(`[rover-for-hire] the tunnel stopped answering (${misses} checks); remote access is off until mode.sh hybrid`);
  tunnel = null;
  misses = 0;
  store?.set("tunnel", null);
}, 60_000).unref();

let store: Store | null = null;
if (env.P13_DATABASE_URL) {
  try {
    const s = await openStore(env.P13_DATABASE_URL, MISSIONS_DIR, env.P13_PG_SCHEMA ?? "p13");
    console.error(`[rover-for-hire] restored ${await s.restore()} mission file(s) from Postgres`);
    tunnel = await liveTunnel(await s.get<string | null>("tunnel"));
    afterDurableWrite((path) => s.syncDir(dirname(path)));
    const saved = await s.get<{ day: string; atomic: number } | null>("sensor_spend");
    if (saved?.day === today()) sensorSpend = saved;
    store = s;
  } catch (e) {
    console.error(`[rover-for-hire] Postgres copy OFF, mission files last only until the next restart: ${(e as Error).message}`);
  }
} else console.error("[rover-for-hire] P13_DATABASE_URL unset: mission files last only until the next restart");

const SENSORS = {
  remote: true,
  guard: (amount: bigint): string | null => {
    const used = Number(capUsedOn(today())) + sensorToday();
    return used + Number(amount) > DAILY_CAP
      ? `This server's daily cap is ${DAILY_CAP / 1e6} USDC for all users together; ${(used / 1e6).toFixed(4)} is already spent or held today.` : null;
  },
  spent: (amount: bigint): void => {
    sensorSpend = { day: today(), atomic: sensorToday() + Number(amount) };
    store?.set("sensor_spend", sensorSpend);
  },
};

function reply(res: ServerResponse, code: number, body: unknown, extra: Record<string, string> = {}) {
  res.writeHead(code, { "Content-Type": "application/json", ...extra });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1 << 20) throw new Error("body too large");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

function userOf(req: IncomingMessage, pathKey: string | undefined) {
  const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
  const key = pathKey ?? bearer;
  return key ? USER_KEYS.find((u) => same(u.key, key)) ?? null : null;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/health" && req.method === "OPTIONS") { // a browser's CORS preflight (Firefox adds cache headers)
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET",
                         "Access-Control-Allow-Headers": "*", "Access-Control-Max-Age": "86400" });
    return void res.end();
  }
  if (url.pathname === "/health")
    return reply(res, 200, { ok: true, remote_access: tunnel !== null, copy: store ? "postgres" : "off",
                             cap_used_today_usdc: (Number(capUsedOn(today())) + sensorToday()) / 1e6 },
                 { "Access-Control-Allow-Origin": "*" }); // the website's live online/offline badge reads it; nothing private here

  if (url.pathname === "/owner/tunnel") {
    if (!same(String(req.headers["x-p13-owner-key"] ?? ""), OWNER_KEY)) return reply(res, 403, { error: "forbidden" });
    if (req.method === "DELETE") { tunnel = null; store?.set("tunnel", null); return reply(res, 200, { remote_access: false }); }
    if (req.method !== "POST") return reply(res, 405, { error: "POST or DELETE" });
    const body = (await readJson(req)) as { url?: string } | undefined;
    const ok = /^https:\/\/[a-z0-9.-]+$/i.test(body?.url?.replace(/\/$/, "") ?? "")
      || (env.P13_LOCAL_TEST === "1" && /^http:\/\/127\.0\.0\.1:\d+$/.test(body?.url ?? "")); // the edge on this machine, for tests
    if (!body?.url || !ok) return reply(res, 400, { error: "url: https://host" });
    tunnel = body.url.replace(/\/$/, "");
    store?.set("tunnel", tunnel);
    return reply(res, 200, { remote_access: true });
  }

  const m = /^\/mcp(?:\/([^/]+))?\/?$/.exec(url.pathname);
  if (!m) return reply(res, 404, { error: "not found" });
  const user = userOf(req, m[1]);
  if (!user) return reply(res, 401, { error: "a valid key is needed: /mcp/<key> or Authorization: Bearer <key>" });
  if (req.method !== "POST") return reply(res, 405, { error: "this server is stateless: POST only" });

  const body = await readJson(req);
  const server = new McpServer({ name: "rover-for-hire", version: "1.0.0" });
  registerHederaTools(server, user.label);
  registerSensorTools(server, SENSORS, user.label);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

const web = http.createServer((req, res) => {
  handle(req, res).catch((e) => { if (!res.headersSent) reply(res, 500, { error: (e as Error).message.slice(0, 200) }); });
}).listen(PORT, () => console.error(`[rover-for-hire] remote MCP on :${PORT}, ${USER_KEYS.length} user key(s), daily cap ${DAILY_CAP / 1e6} USDC`));

// Render stops the service with SIGTERM (deploys, restarts): finish the copies first, at most 20 s.
process.on("SIGTERM", () => {
  web.close();
  const done = () => process.exit(0);
  setTimeout(done, 20_000).unref();
  void (store?.flush() ?? Promise.resolve()).then(done);
});


// Remote MCP over Streamable HTTP: rover tools only, user keys, daily cap.
// A tunnel that stops answering 3 health checks a minute apart is dropped.
// The /health endpoint answers CORS preflights so the website badge works in Brave.
const TUNNEL_LIVENESS_CHECKS = 3;
const TUNNEL_CHECK_INTERVAL_MS = 60_000;
