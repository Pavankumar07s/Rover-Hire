// Rover storefront (one per seller). Free: A2A, start, status, end. Paid (x402, USDC on Hedera, Base Sepolia or Solana devnet): move, photo.
import { createHash } from "node:crypto";
import { CHAINS, HcsLog, HcsSpool, NETWORK, operatorClient, parseKey, USDC, type ChainInfo } from "@0xBs/hedera";
import type { HTTPRequestContext, RoutesConfig } from "@x402/core/server";
import express, { type NextFunction, type Request, type Response } from "express";
import { a2aRouter } from "./a2a.js";
import { cfg, PAY } from "./config.js";
import { Payments, type SettledPayment } from "./payments.js";
import { Quotes } from "./quotes.js";
import { RoverClient } from "./rover.js";

const HEARTBEAT_MS = 250;

const quotes = new Quotes(cfg.seller);
const rover = new RoverClient(cfg.roverUrl, cfg.roverToken);
const hcs = await HcsLog.open(operatorClient(cfg.payTo, parseKey(cfg.roverKey, "HEDERA_ROVER_KEY")), cfg.moneyTopic);
// HCS writes take seconds: spooled to disk in order, never in the payment's response path, resumed after a restart.
const spool = new HcsSpool(hcs, new URL(`../data/hcs-money-${cfg.seller}.jsonl`, import.meta.url).pathname);
void spool.drain();
const hcsLog = (entry: Record<string, unknown>) => spool.enqueue(entry);

interface Settled {
  facilitator: string;
  network: string;
  quoteId: string;
  kind: "move" | "photo";
  n: number | null;
  amount: string;
  tx: string;
  payer: string;
}

async function onSettled(s: Settled): Promise<void> {
  const q = quotes.get(s.quoteId);
  if (!q) return;
  if (s.kind === "move") {
    q.move_txs.push(s.tx);
    q.moves_paid += 1;
  } else q.photos_paid[String(s.n)] = s.tx;
  quotes.save();
  if (s.kind === "move") await rover.money(q.quote_id, q.moves_paid, q.move_txs).catch((e) => console.error((e as Error).message));
  // On Rover-A's money topic whichever chain paid: `network` names it (left out for Hedera, as before), `tx` is that chain's.
  hcsLog({ type: s.kind, quote_id: q.quote_id, ...(s.network === NETWORK ? {} : { network: s.network }), tx: s.tx, amount: s.amount, payer: s.payer, facilitator: s.facilitator,
           request_id: null, seg_root: null, photo_sha: null, ...(s.n !== null ? { photo: s.n } : {}) });
  console.log(`settled ${s.kind}${s.n !== null ? " " + s.n : ""} for ${q.quote_id} on ${s.network} via ${s.facilitator}: ${s.tx}`);
}

function price(kind: "move" | "photo", chain: ChainInfo) {
  return (ctx: HTTPRequestContext) => {
    const q = quotes.get(ctx.path.split("/")[2]);
    if (!q) throw new Error("unknown quote");
    const amount = cfg.priceFactor === 1 ? q[kind] : (BigInt(q[kind]) * BigInt(Math.round(cfg.priceFactor * 1000)) / 1000n).toString();
    return { asset: chain.usdc, amount, ...(chain.extra ? { extra: chain.extra } : {}) };
  };
}

function routes(): RoutesConfig {
  // The agreed price on every chain this seller takes: one 402 offers them all and the buyer pays on the one it chose.
  const opt = (kind: "move" | "photo", extra?: Record<string, unknown>) => PAY.map(({ chain, payTo }) => ({
    scheme: "exact", network: chain.network, payTo: chain === CHAINS.hedera ? cfg.testPayTo ?? payTo : payTo, price: price(kind, chain),
    maxTimeoutSeconds: 60, ...(extra ? { extra } : {}),
  }));
  return {
    // Money is final before the wheels turn.
    "POST /missions/:q/move": { accepts: opt("move", { paymentFlow: "upfront" }), description: "one move of the rover, paid before it moves" },
    // Default authorization flow: settled only if the photo handler succeeds.
    "POST /missions/:q/photo/:n": { accepts: opt("photo"), description: "one inspection photo, paid only on delivery", mimeType: "image/jpeg" },
  };
}

const payments = new Payments(routes, async (p: SettledPayment) => {
  const [, , quoteId, kind, n] = p.path.split("/");
  await onSettled({ facilitator: p.facilitator, network: p.network, quoteId: quoteId!, kind: kind as "move" | "photo", n: n ? Number(n) : null,
                    amount: p.amount, tx: p.tx, payer: p.payer });
}, new URL(`../data/used-payments-${cfg.seller}.json`, import.meta.url).pathname);
await payments.start();

const app = express();
app.use(express.json());
app.use(a2aRouter(quotes));

app.post("/missions/:q/start", async (req, res) => {
  const q = quotes.get(req.params.q);
  if (!q) return void res.status(404).json({ error: "unknown quote" });
  if (q.status === "quoted") return void res.status(409).json({ error: "quote not accepted" });
  if (q.status === "started") return void res.json({ ok: true, quote_id: q.quote_id, status: q.status });
  try {
    const started = await rover.missionStart(q.quote_id, q.mission, q.photos_wanted);
    q.status = "started";
    quotes.save();
    hcsLog({ type: "quote", quote_id: q.quote_id, tx: null, amount: q.move, photo_price: q.photo, pay_to: q.pay_to, payer: null,
             request_id: null, seg_root: null, photo_sha: null });
    res.json({ ok: true, quote_id: q.quote_id, status: q.status, camera: started.camera_calibration ?? null });
  } catch (e) {
    // The rover's own reason (busy, battery, IMU) goes to the buyer as is: nothing has been paid yet. 409, not 502/503:
    // Cloudflare (the Phase 13 tunnel) replaces 5xx replies with its own page, and the buyer would never see why.
    const msg = (e as Error).message;
    const ready = /rover not ready: (.*)$/s.exec(msg);
    if (/: HTTP 409 /.test(msg)) return void res.status(409).json({ error: "rover busy: another mission is running; try again in a few minutes" });
    res.status(ready ? 409 : 502).json({ error: ready ? `rover not ready: ${ready[1]}` : msg });
  }
});

app.get("/missions/:q/status", async (req, res) => {
  const q = quotes.get(req.params.q);
  if (!q) return void res.status(404).json({ error: "unknown quote" });
  const r = await rover.status().catch(() => null);
  const mine = r?.mission?.quote_id === q.quote_id;
  const roverEnded = mine && r.progress?.running === false;  // the rover stopped its own mission (e.g. battery)
  res.json({
    quote_id: q.quote_id, status: roverEnded ? "ended" : q.status, stop_reason: roverEnded ? r.progress.end_reason ?? "the rover stopped" : null,
    move: q.move, photo: q.photo, moves_paid: q.moves_paid,
    moves_used: mine ? r.leases.used : null, money_ok: mine ? r.leases.money_ok : null,
    photos_ready: mine ? r.photos.map((p: { n: number }) => p.n) : [], photos_paid: Object.keys(q.photos_paid).map(Number),
    move_txs: q.move_txs, photo_txs: q.photos_paid, // for the HUD's payment ticker
    photos_wanted: q.photos_wanted, rover_state: r?.state ?? "unreachable", facilitator: payments.facilitator(),
  });
});

app.post("/missions/:q/end", async (req, res) => {
  const q = quotes.get(req.params.q);
  if (!q) return void res.status(404).json({ error: "unknown quote" });
  if (q.status !== "ended") {
    q.status = "ended";
    quotes.save();
    await rover.missionEnd(q.quote_id).catch((e) => console.error((e as Error).message));
    hcsLog({ type: "end", quote_id: q.quote_id, tx: null, amount: null, payer: null, moves_paid: q.moves_paid,
             photos_paid: Object.keys(q.photos_paid).length, request_id: null, seg_root: null, photo_sha: null });
  }
  res.json({ ok: true, quote_id: q.quote_id, moves_paid: q.moves_paid, photos_paid: q.photos_paid });
});

// Paid routes exist only for a started mission: no 402 for quotes that cannot be served.
const servable = (req: Request, res: Response, next: NextFunction) => {
  const q = quotes.get(String(req.params.q));
  if (!q) return void res.status(404).json({ error: "unknown quote" });
  if (q.status !== "started") return void res.status(409).json({ error: `mission is ${q.status}` });
  next();
};
app.use("/missions/:q/move", servable);
app.use("/missions/:q/photo/:n", servable);
app.use(payments.middleware);

app.post("/missions/:q/move", (req, res) => {
  const q = quotes.get(req.params.q)!;
  res.json({ ok: true, quote_id: q.quote_id, moves_paid: q.moves_paid });
});

app.post("/missions/:q/photo/:n", async (req, res) => {
  const r = await rover.photo(Number(req.params.n)).catch(() => null);
  if (!r?.ok) return void res.status(502).json({ error: `photo ${req.params.n} not available from the rover (${r?.status ?? "unreachable"})` });
  const jpeg = Buffer.from(await r.arrayBuffer());
  res.set("X-Photo-Sha256", createHash("sha256").update(jpeg).digest("hex")).type("image/jpeg").send(jpeg);
});

app.get("/health", (_req, res) => res.json({ ok: true, seller: cfg.seller, pay_to: cfg.payTo, facilitator: payments.facilitator(),
                                            facilitators: payments.health, money_topic: cfg.moneyTopic, hcs_seq: hcs.seq, hcs_pending: spool.pending(),
                                            test_mode: cfg.testMode, price_factor: cfg.priceFactor }));

// Money heartbeat: the rover's money lease lapses 1 s after the last one (HANDOFF §11).
setInterval(() => {
  for (const q of quotes.active()) void rover.moneyHeartbeat(q.quote_id).catch(() => undefined);
}, HEARTBEAT_MS);

if (cfg.priceFactor !== 1) console.warn(`TEST MODE: every 402 asks ${cfg.priceFactor} x the agreed price (PRICE_FACTOR_TEST)`);
app.listen(cfg.port, () => console.log(`${cfg.name} shop on :${cfg.port}, payTo ${cfg.payTo}, money topic ${cfg.moneyTopic}`));
// 2026-11-06T13:02:00
// 2026-11-06T22:38:24


// HcsSpool: disk-backed queue that resumes from the last message after restart.
// DynamicPrice reads from the accepted quote, not a fixed env var.
// A Base or Solana settle that returns failed/pending is checked on-chain
// before answering 402, preventing double-payment.
export function getDynamicPrice(quoteId: string, kind: "move" | "photo") {
  const q = getQuote(quoteId);
  if (!q) throw new Error("unknown quote " + quoteId);
  return kind === "move" ? q.priceMove : q.pricePhoto;
}
