// Phase 13 hybrid: the only door from the tunnel into the laptop. It lets through the shops' (and Station-A's) public routes and
// read-only zg-log, needs P13_EDGE_KEY for starting and ending a mission (quote ids are public), and answers 404 to
// everything else. Node standard library only; listens on 127.0.0.1.
//   P13_EDGE_KEY=... node edge.mjs
import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.P13_EDGE_PORT ?? 8412);
const KEY = process.env.P13_EDGE_KEY ?? "";
if (KEY.length < 24) throw new Error("P13_EDGE_KEY is missing or shorter than 24 characters");
const MAX_BODY = 256 * 1024;
const RATE = { perSecond: 20, burst: 40 };

const UPSTREAM = { "rover-a": 8402, "rover-b": 8403, zg: 8787, "station-a": 8404 };
const Q = "[a-z]-[0-9a-f]{8}";
const SHOP_ROUTES = [
  ["GET", /^\/\.well-known\/agent-card\.json$/, false],
  ["POST", /^\/a2a\/jsonrpc$/, false],
  ["GET", new RegExp(`^/missions/${Q}/status$`), false],
  ["POST", new RegExp(`^/missions/${Q}/move$`), false],
  ["POST", new RegExp(`^/missions/${Q}/photo/[1-9][0-9]?$`), false],
  ["POST", new RegExp(`^/missions/${Q}/start$`), true],
  ["POST", new RegExp(`^/missions/${Q}/end$`), true],
  ["GET", /^\/health$/, false],
];
const ZG_ROUTES = [["GET", /^\/segments$/, false], ["GET", /^\/records$/, false], ["GET", /^\/health$/, false]];
// Station-A (Phase 14): its free info and health, and its three paid reads. Nothing else of the station shop.
const STATION_ROUTES = [["GET", /^\/station\/(info|reading|motion|history)$/, false], ["GET", /^\/health$/, false]];
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer",
  "transfer-encoding", "upgrade", "host", "x-p13-edge-key", "content-length"]);

const keyOk = (got) => {
  const a = Buffer.from(String(got ?? "")), b = Buffer.from(KEY);
  return a.length === b.length && timingSafeEqual(a, b);
};

const buckets = new Map();
function allowed(ip) {
  const now = Date.now(), b = buckets.get(ip) ?? { tokens: RATE.burst, at: now };
  b.tokens = Math.min(RATE.burst, b.tokens + ((now - b.at) / 1000) * RATE.perSecond);
  b.at = now;
  const ok = b.tokens >= 1;
  if (ok) b.tokens -= 1;
  buckets.set(ip, b);
  return ok;
}

/** [upstream port, path for it] when the request may pass, else an HTTP status to answer with. */
export function route(method, url, headers) {
  const u = new URL(url, "http://edge");
  const [, first, ...rest] = u.pathname.split("/");
  if (u.pathname === "/edge/health") return 200;
  const port = UPSTREAM[first];
  if (!port) return 404;
  const path = "/" + rest.join("/");
  const rule = (first === "zg" ? ZG_ROUTES : first === "station-a" ? STATION_ROUTES : SHOP_ROUTES).find(([m, re]) => m === method && re.test(path));
  if (!rule) return 404;
  if (rule[2] && !keyOk(headers["x-p13-edge-key"])) return 403;
  return [port, path + u.search];
}

function reply(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const ip = String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress);
  if (!allowed(ip)) return reply(res, 429, { error: "too many requests" });
  const r = route(req.method, req.url, req.headers);
  if (r === 200) return reply(res, 200, { ok: true, edge: "p13" });
  if (typeof r === "number") return reply(res, r, { error: r === 403 ? "forbidden" : "not found" });
  const [port, path] = r;
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HOP.has(k)));
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) { reply(res, 413, { error: "body too large" }); req.destroy(); } else chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    const body = Buffer.concat(chunks);
    const up = http.request({ host: "127.0.0.1", port, method: req.method, path, timeout: 60_000,
      headers: { ...headers, ...(body.length ? { "content-length": body.length } : {}) } }, (ur) => {
      const out = Object.fromEntries(Object.entries(ur.headers).filter(([k]) => !HOP.has(k)));
      res.writeHead(ur.statusCode ?? 502, out);
      ur.pipe(res);
    });
    up.on("timeout", () => up.destroy(new Error("upstream timeout")));
    up.on("error", (e) => { if (!res.headersSent) reply(res, 502, { error: `upstream: ${e.message}` }); else res.end(); });
    up.end(body);
  });
});

if (process.argv[1]?.endsWith("edge.mjs")) server.listen(PORT, "127.0.0.1", () => console.log(`p13-edge on 127.0.0.1:${PORT}`));
