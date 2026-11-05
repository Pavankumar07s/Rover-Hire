// A2A v1.0 seller (@a2a-js/sdk 1.3.0, JSON-RPC, data parts), plan §3.6: rfq → quote → counter → quote{meetsOffer|final}
// → accept → accepted{x402} / decline. Prices are atomic USDC strings. A counter at or above the floor is met; below it,
// the ask moves halfway toward it, never below the floor; the quote is final after 3 rounds or at the floor.
import { randomUUID } from "node:crypto";
import { AGENT_CARD_PATH, Role } from "@a2a-js/sdk";
import { AgentEvent, DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import { NETWORK, SKILL, USDC } from "@0xBs/hedera";
import express from "express";
import { cfg, payList } from "./config.js";
import type { Quote, Quotes } from "./quotes.js";

const EXTENSION = "https://rover-for-hire.dev/ext/x402-hedera/v1";
const ROUNDS = 3;
const BODY = cfg.sim ? "simulated" : "arduino-uno-q";

function card() {
  const description = cfg.sim
    ? "Simulated seller with no physical body: quotes parcel inspections at a higher price and holds firm. It cannot run a mission."
    : "Real 4WD rover for hire: inspects a parcel with a camera; every move is a 0G TEE-proven decision paid in USDC with x402 on Hedera.";
  return {
    name: cfg.name,
    version: "1.0.0",
    description,
    supportedInterfaces: [{ url: `${cfg.publicUrl}/a2a/jsonrpc`, protocolBinding: "JSONRPC", tenant: "", protocolVersion: "1.0" }],
    provider: { organization: "0xBs Rover for Hire", url: cfg.publicUrl },
    capabilities: { streaming: false, pushNotifications: false,
                    extensions: [{ uri: EXTENSION, description: "Pays per move and per photo with x402 on hedera:testnet in USDC", required: false,
                                   params: { network: NETWORK, asset: USDC, payTo: cfg.payTo, price: cfg.prices, body: BODY, pay: payList() } }] },
    securitySchemes: {}, securityRequirements: [],
    defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"],
    skills: [{ id: SKILL, name: "Parcel inspection", description: "Quote, negotiate and run a parcel-inspection mission (moves + photos).",
               tags: ["robot", "inspection", "x402"], examples: ['{"type":"rfq","task":"parcel-inspection","mission":"Inspect parcel #3","photos":3}'],
               inputModes: ["application/json"], outputModes: ["application/json"], securityRequirements: [] }],
    signatures: [],
  };
}

const isAtomic = (v: unknown): v is string => typeof v === "string" && /^[0-9]{1,12}$/.test(v);
const big = (v: string) => BigInt(v);

function quoteMsg(q: Quote, extra: Record<string, unknown> = {}) {
  return { type: "quote", quote_id: q.quote_id, price_move: q.move, price_photo: q.photo, currency: "USDC", network: NETWORK, asset: USDC,
           payTo: q.pay_to, pay: payList(), valid_until: q.valid_until, round: q.round, body: BODY, ...extra };
}

/** One price after a counter: met at or above the floor; else halfway (rounded up), never below the floor. */
function step(ask: string, counter: string, floor: string): string {
  if (big(counter) >= big(floor)) return counter;
  const half = (big(ask) + big(counter) + 1n) / 2n;
  return (half > big(floor) ? half : big(floor)).toString();
}

function counter(q: Quote, data: any): Record<string, unknown> {
  if (q.status !== "quoted") return { type: "error", error: `quote is ${q.status}` };
  if (q.final) return quoteMsg(q, { final: true, note: "final offer already given" });
  if (Date.parse(q.valid_until) < Date.now()) return { type: "error", error: "quote expired" };
  if (!isAtomic(data.price_move) || !isAtomic(data.price_photo)) return { type: "error", error: "counter needs atomic price_move and price_photo" };
  q.round += 1;
  q.move = step(q.move, data.price_move, cfg.floor.move);
  q.photo = step(q.photo, data.price_photo, cfg.floor.photo);
  const meets = q.move === data.price_move && q.photo === data.price_photo;
  const atFloor = (q.move === data.price_move || q.move === cfg.floor.move) && (q.photo === data.price_photo || q.photo === cfg.floor.photo);
  q.final = !meets && (q.round >= ROUNDS || atFloor);
  return quoteMsg(q, meets ? { meetsOffer: true } : q.final ? { final: true } : {});
}

function reply(quotes: Quotes, data: any): { msg: Record<string, unknown>; quote?: Quote } {
  if (data?.type === "rfq") {
    if ((data.task ?? SKILL) !== SKILL) return { msg: { type: "error", error: `unsupported task ${data.task}` } };
    const photos = data.photos ?? data.photos_wanted;
    if (typeof data.mission !== "string" || !Number.isInteger(photos) || photos < 1 || photos > 20)
      return { msg: { type: "error", error: "rfq needs mission and photos (1-20)" } };
    const q = quotes.create(cfg.seller, data.mission, photos, cfg.prices, cfg.payTo);
    return { msg: quoteMsg(q, { note: "list price" }), quote: q };
  }
  const q = quotes.get(data?.quote_id);
  if (!q) return { msg: { type: "error", error: "unknown quote_id" } };
  if (data.type === "counter") return { msg: counter(q, data), quote: q };
  if (data.type === "accept") {
    if (q.status !== "quoted" && q.status !== "accepted") return { msg: { type: "error", error: `quote is ${q.status}` }, quote: q };
    if (cfg.sim) return { msg: { type: "error", error: "simulated seller, no body: it can quote but not run a mission" }, quote: q };
    q.status = "accepted";
    const m = `${cfg.publicUrl}/missions/${q.quote_id}`;
    return { msg: { type: "accepted", quote_id: q.quote_id, price_move: q.move, price_photo: q.photo, payTo: q.pay_to, pay: payList(), network: NETWORK, asset: USDC,
                    x402: { start: `${m}/start`, move: `${m}/move`, photo: `${m}/photo/{n}`, status: `${m}/status`, end: `${m}/end` } }, quote: q };
  }
  if (data.type === "decline") {
    if (q.status === "quoted") q.status = "declined";
    return { msg: { type: "declined", quote_id: q.quote_id }, quote: q };
  }
  return { msg: { type: "error", error: `unsupported message type ${data?.type}` }, quote: q };
}

/** Records both sides of the exchange on the quote; accept and decline carry the whole transcript back. */
function negotiate(quotes: Quotes, data: any): Record<string, unknown> {
  const { msg, quote } = reply(quotes, data);
  if (quote) {
    const at = new Date().toISOString();
    quote.transcript.push({ from: "buyer", at, msg: data }, { from: "seller", at, msg });
    quotes.save();
    if (msg.type === "accepted" || msg.type === "declined") return { ...msg, transcript: quote.transcript };
  }
  return msg;
}

export function a2aRouter(quotes: Quotes): express.Router {
  const executor = {
    async execute(ctx: any, bus: any) {
      const data = ctx.userMessage.parts.find((p: any) => p.content?.$case === "data")?.content.value;
      bus.publish(AgentEvent.message({
        messageId: randomUUID(), contextId: ctx.contextId, taskId: "", role: Role.ROLE_AGENT,
        parts: [{ content: { $case: "data", value: negotiate(quotes, data) }, metadata: undefined, filename: "", mediaType: "application/json" }],
        metadata: undefined, extensions: [], referenceTaskIds: [],
      } as any));
      bus.finished();
    },
    async cancelTask() {},
  };
  const handler = new DefaultRequestHandler(card() as any, new InMemoryTaskStore(), executor as any);
  const router = express.Router();
  router.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: handler }));
  router.use("/a2a/jsonrpc", jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
  return router;
}
