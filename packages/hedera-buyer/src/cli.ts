#!/usr/bin/env node
// hedera-buyer find                                   ERC-8004 discovery with the card checks
// hedera-buyer negotiate --photos N --budget X        discovery + negotiation; the chosen quote is accepted, then ended
//                                                     --chain hedera|base|solana (both): where the mission is paid
// hedera-buyer mission --seller <url> --photos N ...  straight to one seller at list price (P5/P6 path)
// hedera-buyer hire --photos N --budget X             discovery + negotiation + audit + mission via Agent Kit + feedback
// hedera-buyer audit-setup                            creates the Agent Kit audit topic and saves AUDIT_TOPIC
// hedera-buyer sensor find|reading|motion|history [--minutes N] [--station <agentId>]   Station-A, D16 limits (Phase 12)
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import { CHAINS, HcsLog, operatorClient, parseKey, usdcAtomic, type Chain } from "@0xBs/hedera";
import { BuyerAgent, createAuditTopic } from "./agentkit.js";
import { findRovers } from "./discovery.js";
import { hire, MISSION } from "./hire.js";
import { quickDeal, runMission } from "./mission.js";
import { negotiate } from "./negotiate.js";
import { Payer } from "./payer.js";
import { buySensor, findStations, SeenStore, STATION_LIMITS } from "./sensors.js";

const ENV = new URL("../.env", import.meta.url).pathname;

loadEnv({ path: ENV, quiet: true });
const say = (m: string) => console.error(m);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    seller: { type: "string" }, photos: { type: "string", default: "0" }, budget: { type: "string", default: "0.80" },
    ahead: { type: "string", default: "3" }, "max-s": { type: "string", default: "60" }, mission: { type: "string", default: MISSION },
    "per-merchant": { type: "string", default: "0.80" }, "stall-s": { type: "string", default: "25" }, "photo-dir": { type: "string" },
    "est-moves": { type: "string", default: process.env.EST_MOVES ?? "20" },  // 5-photo missions with a scan first: 18-26 moves
    minutes: { type: "string", default: "10" }, station: { type: "string" }, chain: { type: "string", default: "hedera" },
  },
});
if (!(values.chain! in CHAINS)) throw new Error(`--chain must be hedera, base or solana, not ${values.chain}`);
const chain = values.chain as Chain;
const command = positionals[0];
const erc8004From = () => {
  const v = Number(process.env.ERC8004_FROM);
  if (!v) throw new Error("ERC8004_FROM is not set (packages/hedera-buyer/.env)");
  return v;
};

async function buyer() {
  const buyerId = process.env.HEDERA_BUYER_ID?.trim();
  if (!buyerId) throw new Error("HEDERA_BUYER_ID is not set (packages/hedera-buyer/.env)");
  const keyRaw = process.env.HEDERA_BUYER_KEY ?? "";
  const key = parseKey(keyRaw, "HEDERA_BUYER_KEY");
  const topic = process.env.HCS_SPEND_TOPIC?.trim();
  const log = topic ? await HcsLog.open(operatorClient(buyerId, key), topic) : null;
  const payer = new Payer(buyerId, keyRaw, { capPerPayment: "$0.20", budget: usdcAtomic(values.budget!), perMerchant: usdcAtomic(values["per-merchant"]!),
                                             approvalThreshold: usdcAtomic("0.50") }, log);
  return { buyerId, keyRaw, key, payer };
}
const missionOptions = () => ({ photos: Number(values.photos), ahead: Number(values.ahead), maxS: Number(values["max-s"]),
                                stallS: Number(values["stall-s"]), ...(values["photo-dir"] ? { photoDir: values["photo-dir"] } : {}) });

if (command === "audit-setup") {
  if (process.env.AUDIT_TOPIC) throw new Error(`AUDIT_TOPIC is already ${process.env.AUDIT_TOPIC}`);
  const b = await buyer();
  const topic = await createAuditTopic(new BuyerAgent(b.buyerId, b.keyRaw, b.payer, 0n, null));
  appendFileSync(ENV, `AUDIT_TOPIC=${topic}\n`);
  console.log(JSON.stringify({ audit_topic: topic }));
} else if (command === "hire") {
  const r = await hire({ buyerId: process.env.HEDERA_BUYER_ID!.trim(), keyRaw: process.env.HEDERA_BUYER_KEY ?? "", erc8004From: erc8004From(),
                         spendTopic: process.env.HCS_SPEND_TOPIC?.trim() || null, auditTopic: process.env.AUDIT_TOPIC?.trim() || null },
                       { ...missionOptions(), mission: values.mission!, budget: usdcAtomic(values.budget!), perMerchant: usdcAtomic(values["per-merchant"]!),
                         estMoves: Number(values["est-moves"]), chain,
                         keys: { evm: process.env.AGENT_EVM_PRIVATE_KEY?.trim(), solana: process.env.AGENT_SOLANA_PRIVATE_KEY?.trim() } }, { say });
  if (!r.negotiation.deal) throw new Error(`no seller within budget: ${r.negotiation.declined.map((d) => `#${d.agentId} ${d.reason}`).join("; ")}`);
  console.log(JSON.stringify({ negotiation: r.negotiation, audit: r.audit, mission: r.mission, feedback: r.feedback }, null, 2));
} else if (command === "find") {
  console.log(JSON.stringify(await findRovers(erc8004From()), null, 2));
} else if (command === "negotiate") {
  const rovers = await findRovers(erc8004From());
  for (const r of rovers.filter((v) => !v.valid)) say(`skip agent #${r.agentId} ${r.name}: ${r.reasons.join("; ")}`);
  const n = await negotiate(rovers.filter((r) => r.valid), { mission: values.mission!, photos: Number(values.photos),
                                                               budget: usdcAtomic(values.budget!), estMoves: Number(values["est-moves"]), chain }, say);
  if (n.deal) await fetch(n.deal.x402.end!, { method: "POST" }); // a negotiation test, not a mission
  console.log(JSON.stringify(n, null, 2));
} else if (command === "sensor" && ["find", "reading", "motion", "history"].includes(positionals[1] ?? "")) {
  const stations = await findStations(erc8004From());
  if (positionals[1] === "find") {
    console.log(JSON.stringify(stations, null, 2));
  } else {
    const pick = stations.filter((s) => s.valid && (!values.station || s.agentId === values.station));
    for (const s of stations.filter((v) => !v.valid)) say(`skip station #${s.agentId} ${s.name}: ${s.reasons.join("; ")}`);
    if (!pick.length) throw new Error(`no usable station${values.station ? ` #${values.station}` : ""}`);
    const buyerId = process.env.HEDERA_BUYER_ID!.trim();
    const keyRaw = process.env.HEDERA_BUYER_KEY ?? "";
    const topic = process.env.HCS_SPEND_TOPIC?.trim();
    const log = topic ? await HcsLog.open(operatorClient(buyerId, parseKey(keyRaw, "HEDERA_BUYER_KEY")), topic) : null;
    const payer = new Payer(buyerId, keyRaw, { capPerPayment: "$0.02", budget: STATION_LIMITS.perCall, perMerchant: STATION_LIMITS.perCall,
                                               approvalThreshold: STATION_LIMITS.perPayment }, log);
    const seen = new SeenStore(new URL("../data/station-seen.json", import.meta.url).pathname);
    const r = await buySensor(pick[0]!, positionals[1] as "reading" | "motion" | "history", payer, seen, Number(values.minutes));
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) process.exitCode = 1;
  }
} else if (command === "mission" && values.seller) {
  const { payer } = await buyer();
  const deal = await quickDeal(values.seller, values.mission!, Number(values.photos));
  console.log(JSON.stringify(await runMission(deal, missionOptions(), payer, say), null, 2));
} else {
  console.error("usage: hedera-buyer find | negotiate | hire | audit-setup | mission --seller <url>   (--photos N --budget X [--ahead 3] [--max-s 60])\n" +
                "       hedera-buyer sensor find | reading | motion | history [--minutes N] [--station <agentId>]");
  process.exit(2);
}
process.exit(process.exitCode ?? 0);
// 2026-11-06T15:44:00
// 2026-11-06T22:56:09
