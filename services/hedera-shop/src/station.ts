// Station-A's storefront (plan Phase 12, SELLER=s, :8404). Free: /station/info and /health. Paid in USDC with x402,
// pay-on-success: /station/reading, /station/motion, /station/history?minutes=N. The station's own signature travels
// with every reading; a failed or stale read answers 5xx, so it is never charged.
import { createHash } from "node:crypto";
import { CHAINS, HcsLog, HcsSpool, NETWORK, operatorClient, parseKey, USDC, usdcAtomic } from "@0xBs/hedera";
import type { HTTPRequestContext, RoutesConfig } from "@x402/core/server";
import { config as loadEnv } from "dotenv";
import express from "express";
import { Payments, type SettledPayment } from "./payments.js";

loadEnv({ path: new URL("../.env.s", import.meta.url).pathname, quiet: true });
const need = (name: string): string => {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set (services/hedera-shop/.env.s)`);
  return v;
};
const cfg = {
  name: process.env.SHOP_NAME ?? "Station-A",
  port: Number(process.env.PORT ?? 8404),
  payTo: need("HEDERA_STATION_ID"),
  key: need("HEDERA_STATION_KEY"),
  salesTopic: need("HCS_SALES_TOPIC"),
  stationUrl: need("STATION_URL").replace(/\/$/, ""),
  stationToken: need("STATION_LAN_TOKEN"),
  signer: need("STATION_SIGNER"),
  agentId: process.env.ERC8004_AGENT_ID?.trim() || null,
  // Phase 14: where Station-A is paid on Base Sepolia and Solana devnet; a chain without one is not offered.
  basePayTo: process.env.STATION_BASE_PAY_TO?.trim() || null,
  solanaPayTo: process.env.STATION_SOLANA_PAY_TO?.trim() || null,
  prices: { // D16
    reading: usdcAtomic(process.env.PRICE_READING ?? "0.001").toString(),
    motion: usdcAtomic(process.env.PRICE_MOTION ?? "0.0005").toString(),
    historyPerMin: usdcAtomic(process.env.PRICE_HISTORY_PER_MIN ?? "0.0002").toString(),
  },
};
const HISTORY_COVER = 0.9; // history is sold only when the station holds at least 90 % of the minutes asked

const hcs = await HcsLog.open(operatorClient(cfg.payTo, parseKey(cfg.key, "HEDERA_STATION_KEY")), cfg.salesTopic);
const spool = new HcsSpool(hcs, new URL("../data/hcs-sales-s.jsonl", import.meta.url).pathname);
void spool.drain();

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const delivered = new Map<string, string>(); // payment header -> sha256 of the body it bought (until settled)

async function station(path: string): Promise<{ status: number; text: string }> {
  try {
    const r = await fetch(`${cfg.stationUrl}${path}`, { headers: { "X-Station-Token": cfg.stationToken }, signal: AbortSignal.timeout(5000) });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { status: 0, text: `station unreachable: ${(e as Error).message}` };
  }
}

function minutesOf(ctx: HTTPRequestContext): number {
  const q = ctx.adapter.getQueryParams?.()?.minutes ?? new URL(ctx.adapter.getUrl(), "http://x").searchParams.get("minutes");
  const m = Number(Array.isArray(q) ? q[0] : q);
  if (!Number.isInteger(m) || m < 1 || m > 60) throw new Error("minutes must be 1-60");
  return m;
}

/** Where Station-A takes USDC: Hedera always, Base Sepolia and Solana devnet when it has an address there. */
const PAY = [
  { chain: CHAINS.hedera, payTo: cfg.payTo },
  ...(cfg.basePayTo ? [{ chain: CHAINS.base, payTo: cfg.basePayTo }] : []),
  ...(cfg.solanaPayTo ? [{ chain: CHAINS.solana, payTo: cfg.solanaPayTo }] : []),
];

function routes(): RoutesConfig {
  // The same price on every chain: one 402 offers them all and the buyer picks one.
  const opt = (amount: string | ((ctx: HTTPRequestContext) => string)) => PAY.map(({ chain, payTo }) => ({
    scheme: "exact", network: chain.network, payTo, maxTimeoutSeconds: 60,
    price: (ctx: HTTPRequestContext) => ({ asset: chain.usdc, amount: typeof amount === "string" ? amount : amount(ctx),
                                           ...(chain.extra ? { extra: chain.extra } : {}) }),
  }));
  return {
    "GET /station/reading": { accepts: opt(cfg.prices.reading), description: "one signed climate, light and motion reading", mimeType: "application/json" },
    "GET /station/motion": { accepts: opt(cfg.prices.motion), description: "the signed motion count", mimeType: "application/json" },
    "GET /station/history": {
      accepts: opt((ctx) => (BigInt(cfg.prices.historyPerMin) * BigInt(minutesOf(ctx))).toString()),
      description: "signed samples, one per 10 s, for the last N minutes (1-60)", mimeType: "application/json",
    },
  };
}

const payments = new Payments(routes, async (p: SettledPayment) => {
  const type = p.path.split("/")[2] ?? "?";
  const readingHash = p.paymentHeader ? delivered.get(p.paymentHeader) ?? null : null;
  if (p.paymentHeader) delivered.delete(p.paymentHeader);
  // The sale goes on Station-A's HCS topic whichever chain paid: `network` says which, `tx` is that chain's transaction.
  spool.enqueue({ type, network: p.network, tx: p.tx, amount: p.amount, payer: p.payer, facilitator: p.facilitator, reading_hash: readingHash });
  console.log(`sold ${type} for ${p.amount} on ${p.network} via ${p.facilitator}: ${p.tx}`);
}, new URL("../data/used-payments-s.json", import.meta.url).pathname);
await payments.start();

const app = express();

app.get("/station/info", async (_req, res) => {
  const h = await station("/health");
  const health = h.status === 200 ? JSON.parse(h.text) : null;
  res.json({ name: cfg.name, agentId: cfg.agentId, payTo: cfg.payTo, network: NETWORK, asset: USDC, signer: cfg.signer,
             pay: PAY.map(({ chain, payTo }) => ({ network: chain.network, payTo, asset: chain.usdc })),
             prices: { reading: cfg.prices.reading, motion: cfg.prices.motion, history_per_min: cfg.prices.historyPerMin },
             sensors: health?.sensors ?? null, online: health?.ok ?? false, problem: health ? health.problem : h.text,
             units: { temp: "centi-°C", rh: "centi-%RH", pressure: health?.sensors?.pressure ? "Pa" : "not available (sensor fault)",
                      light: "relative % (LDR, not lux): 0 = covered, 100 = a torch against it" } });
});

app.get("/health", (_req, res) => res.json({ ok: true, seller: "s", pay_to: cfg.payTo, facilitator: payments.facilitator(),
                                            facilitators: payments.health, sales_topic: cfg.salesTopic, hcs_seq: hcs.seq,
                                            hcs_pending: spool.pending() }));

app.get("/station/history", (req, res, next) => {
  const m = Number(req.query.minutes);
  if (Number.isInteger(m) && m >= 1 && m <= 60) return next();
  res.status(400).json({ error: "minutes must be a whole number from 1 to 60" });
});

app.use(payments.middleware);

// The handlers run only after a valid payment was verified; their 2xx is what lets it settle (authorization flow).
async function sell(req: express.Request, res: express.Response, path: string) {
  const r = await station(path);
  if (r.status !== 200) return void res.status(r.status === 503 ? 503 : 502).json({ error: r.text.slice(0, 200) });
  if (path.startsWith("/history")) {
    const body = JSON.parse(r.text);
    const have = (body.samples?.length ?? 0) * body.every_s / 60;
    if (have < body.minutes * HISTORY_COVER)
      return void res.status(503).json({ error: `the station holds ${have.toFixed(1)} of the ${body.minutes} minutes asked` });
  }
  const header = req.header("payment-signature") ?? req.header("x-payment");
  if (header) delivered.set(header, sha256(r.text));
  res.type("application/json").send(r.text);
}

app.get("/station/reading", (req, res) => void sell(req, res, "/reading"));
app.get("/station/motion", (req, res) => void sell(req, res, "/motion"));
app.get("/station/history", (req, res) => void sell(req, res, `/history?minutes=${Number(req.query.minutes)}`));

app.listen(cfg.port, () => console.log(`${cfg.name} shop on :${cfg.port}, payTo ${cfg.payTo}, sales topic ${cfg.salesTopic}, signer ${cfg.signer}`));
