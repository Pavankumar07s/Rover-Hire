// zg-log on :8787. Writes need X-ZG-Log-Token; reads are public (the same data ends up on 0G anyway).
import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
import { EpisodeLog, GALILEO } from "@0xBs/zg";
import { JsonRpcProvider, Wallet, formatEther } from "ethers";
import express, { type NextFunction, type Request, type Response } from "express";
import { Episodes } from "./episodes.js";
import { SerialQueue } from "./queue.js";

const env = (name: string): string => {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set (services/zg-log/.env)`);
  return v;
};
const TOKEN = env("ZG_LOG_TOKEN");
if (TOKEN.length < 24) throw new Error("ZG_LOG_TOKEN must be 24+ characters");
const PORT = Number(process.env.PORT ?? 8787);
const SEGMENT_S = Number(process.env.SEGMENT_S ?? 60);

const provider = new JsonRpcProvider(GALILEO.rpc, GALILEO.chainId, { staticNetwork: true });
const signer = new Wallet(env("ZG_PRIVATE_KEY"), provider);
const log = new EpisodeLog(env("EPISODE_LOG_ADDRESS"), signer);
const queue = new SerialQueue();
const episodes = new Episodes(new URL("../data/", import.meta.url).pathname, log, signer, queue);
episodes.tick();
setInterval(() => episodes.tick(), SEGMENT_S * 1000);

const app = express();
app.use(express.json({ limit: "2mb" }));

function auth(req: Request, res: Response, next: NextFunction): void {
  const got = Buffer.from(req.get("X-ZG-Log-Token") ?? "");
  const want = Buffer.from(TOKEN);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    res.status(401).json({ error: "bad or missing X-ZG-Log-Token" });
    return;
  }
  next();
}

const fail = (res: Response, status: number, e: unknown) => res.status(status).json({ error: (e as Error).message ?? String(e) });

app.post("/episodes", auth, (req, res) => {
  const { episode_id, mission, quote_id = null, photos_wanted = null, seller_agent_id = null } = req.body ?? {};
  if (typeof episode_id !== "string" || typeof mission !== "string") return fail(res, 400, new Error("episode_id and mission are required"));
  const uri = "data:application/json;base64," + Buffer.from(JSON.stringify({ quote_id, mission, photos_wanted, seller_agent_id })).toString("base64");
  try {
    res.status(202).json(episodes.start(episode_id, uri));
  } catch (e) {
    fail(res, 400, e);
  }
});

app.post("/records", auth, (req, res) => {
  const { record, image_b64 = null } = req.body ?? {};
  if (!record || typeof record !== "object") return fail(res, 400, new Error("record is required"));
  try {
    const result = episodes.add(record, image_b64 ? Buffer.from(image_b64, "base64") : null);
    res.status(result === "added" ? 201 : 200).json({ result, next_seq: episodes.count(record.episode_id) });
  } catch (e) {
    fail(res, 409, e);
  }
});

app.post("/photos", auth, (req, res) => {
  const { episode_id, n, image_b64 } = req.body ?? {};
  if (typeof episode_id !== "string" || !Number.isInteger(n) || typeof image_b64 !== "string")
    return fail(res, 400, new Error("episode_id, n and image_b64 are required"));
  try {
    const result = episodes.addPhoto(episode_id, n, Buffer.from(image_b64, "base64"));
    res.status(result === "added" ? 201 : 200).json({ result });
  } catch (e) {
    fail(res, 409, e);
  }
});

app.post("/episodes/:id/end", auth, (req, res) => {
  try {
    res.status(202).json(episodes.end(String(req.params.id)));
  } catch (e) {
    fail(res, 404, e);
  }
});

app.get("/segments", (req, res) => {
  const id = req.query.episode_id;
  const list = typeof id === "string" ? [episodes.get(id)].filter(Boolean) : episodes.all();
  res.json(list.map((s) => ({ ...s, records: episodes.count(s!.episode_id) })));
});

// Per-checkpoint 0G request ids for status views (MCP rover_mission_status).
app.get("/records", (req, res) => {
  const id = String(req.query.episode_id ?? "");
  const last = Math.min(Number(req.query.last ?? 10) || 10, 500);
  res.json({ episode_id: id, records: episodes.count(id), last: episodes.tail(id, last).map((r: any) => ({
    seq: r.seq, request_id: r.request_id, skill: r.decision?.skill ?? null, safe_stop: r.safe_stop?.reason ?? null,
    see: r.decision?.see ?? null, reason: r.decision?.reason ?? null, t_frame_ms: r.t_frame_ms,
    stop_detail: r.safe_stop?.detail ?? null, answered: !!r.raw_response,
    verified: r.proof?.verified ?? false, latency_ms: r.latency_ms, hash: r.hash, photo: r.photo?.n ?? null,
    signer: r.proof?.signer ?? null, provider: r.provider, model: r.model })) });
});

app.get("/health", async (_req, res) => {
  const balance = await provider.getBalance(signer.address).catch(() => null);
  res.json({ ok: true, wallet: signer.address, balance0G: balance === null ? null : formatEther(balance), queue: queue.pending,
             segment_s: SEGMENT_S, episodes: episodes.all().length, contract: await log.contract.getAddress() });
});

app.listen(PORT, () => console.log(`zg-log on :${PORT}, wallet ${signer.address}, segments every ${SEGMENT_S} s`));
// 2026-11-06T09:32:00
