// The whole buyer flow behind `hedera-buyer hire` and the MCP tool hire_rover: ERC-8004 discovery, A2A negotiation,
// the negotiation summary on the audit topic, the mission paid through the Agent Kit tool, then ERC-8004 feedback.
import { CHAINS, evmWallet, HcsLog, liveRelay, operatorClient, parseKey, usdcAtomic, type Chain } from "@0xBs/hedera";
import { BuyerAgent, type ToolResult } from "./agentkit.js";
import { findRovers, type Rover } from "./discovery.js";
import { giveFeedback, type Feedback } from "./feedback.js";
import { runMission, type MissionOptions, type MissionSummary } from "./mission.js";
import { negotiate, paidOn, type Negotiation } from "./negotiate.js";
import { Payer } from "./payer.js";

export interface BuyerEnv {
  buyerId: string;
  keyRaw: string;
  erc8004From: number;
  spendTopic?: string | null;
  auditTopic?: string | null;
}

export interface HireOptions extends MissionOptions {
  mission: string;
  budget: bigint; // atomic USDC, the whole mission
  perMerchant?: bigint;
  estMoves: number;
  chain?: Chain; // the chain the user chose to pay on (Hedera when left out)
  keys?: { evm?: string; solana?: string }; // the buyer's Base and Solana keys (the local wallet file, or the remote server's env)
}

export interface HireHooks {
  say?: (m: string) => void;
  onRovers?: (r: Rover[]) => void;
  onNegotiated?: (n: Negotiation) => void;
  onStarted?: () => void;
  onMissionDone?: (m: MissionSummary) => void; // before the feedback write, which takes 8-12 s
}

export interface HireResult {
  rovers: Rover[];
  negotiation: Negotiation;
  audit: ToolResult["raw"] | null;
  mission: MissionSummary | null;
  feedback: Feedback | null;
  feedbackError?: string; // the mission is still done; only the feedback write failed
  payer: Payer;
}

export const MISSION = "Inspect parcel #3 for damage: find it, approach to about 30 cm, then take photos around it.";
export const CAP_PER_PAYMENT = "$0.20"; // D5
export const APPROVAL_THRESHOLD = "0.50"; // D5: above the cap, so it never triggers, as intended

export async function hire(env: BuyerEnv, o: HireOptions, hooks: HireHooks = {}): Promise<HireResult> {
  const say = hooks.say ?? (() => undefined);
  const key = parseKey(env.keyRaw, "HEDERA_BUYER_KEY");
  const log = env.spendTopic ? await HcsLog.open(operatorClient(env.buyerId, key), env.spendTopic) : null;
  const payer = new Payer(env.buyerId, env.keyRaw, { capPerPayment: CAP_PER_PAYMENT, budget: o.budget, perMerchant: o.perMerchant ?? o.budget,
                                                     approvalThreshold: usdcAtomic(APPROVAL_THRESHOLD) }, log);
  const chain = CHAINS[o.chain ?? "hedera"];
  if (chain.chain !== "hedera") {
    await payer.addChains(o.keys ?? {});
    if (!payer.addressOn(chain.network)) throw new Error(`no ${chain.label} key in the buyer's wallet: nothing was paid`);
  }
  const agent = new BuyerAgent(env.buyerId, env.keyRaw, payer, o.budget, env.auditTopic ?? null);
  const rovers = await findRovers(env.erc8004From);
  hooks.onRovers?.(rovers);
  for (const r of rovers.filter((v) => !v.valid)) say(`skip agent #${r.agentId} ${r.name}: ${r.reasons.join("; ")}`);
  const negotiation = await negotiate(rovers.filter((r) => r.valid), { mission: o.mission, photos: o.photos, budget: o.budget, estMoves: o.estMoves,
                                                                       chain: chain.chain }, say);
  hooks.onNegotiated?.(negotiation);
  const result: HireResult = { rovers, negotiation, audit: null, mission: null, feedback: null, payer };
  if (!negotiation.deal) return result;
  if (env.auditTopic) {
    const a = await agent.audit(negotiation.summary);
    result.audit = a.raw;
    say(`negotiation summary on the audit topic: ${a.raw?.status} ${a.raw?.transactionId ?? ""}`);
  }
  hooks.onStarted?.();
  result.mission = await runMission(negotiation.deal, o, payer, say, agent.pay);
  hooks.onMissionDone?.(result.mission);
  const deal = negotiation.deal;
  const lastPhoto = [...result.mission.payments].reverse().find((p) => p.kind === "photo" && p.ok && p.tx);
  if (lastPhoto && deal.agentId) {
    try {
      result.feedback = await giveFeedback(evmWallet(key, await liveRelay()), { agentId: deal.agentId, endpoint: `${deal.shop}/.well-known/agent-card.json`,
                                                             quoteId: deal.quote_id, photosWanted: o.photos, photosPaid: result.mission.payments.filter((p) => p.kind === "photo" && p.ok).length,
                                                             payTo: paidOn(deal).payTo, proofTx: lastPhoto.tx!, proofAmount: deal.price_photo,
                                                             proofNetwork: paidOn(deal).chain.network });
      say(`feedback ${result.feedback.score} on #${deal.agentId}: tx ${result.feedback.tx}`);
    } catch (e) {
      result.feedbackError = (e as Error).message.slice(0, 200);
      say(`feedback not recorded: ${result.feedbackError}`);
    }
  }
  return result;
}
