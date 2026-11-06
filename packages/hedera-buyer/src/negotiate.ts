// Negotiation over A2A (plan §3.6, D4/D5/D9): an RFQ to every valid seller, one counter at 75 % of its list price,
// then the lowest expected total price_move x EST_MOVES + price_photo x photos within budget wins (tie: the higher
// rating); the others are declined with the reason. Every message both ways goes into the transcript, whose sha256
// and a summary go to the audit topic.
import { createHash } from "node:crypto";
import { CHAINS, usdcString, type Chain, type ChainInfo } from "@0xBs/hedera";
import { Seller } from "./a2a.js";
import type { Rover } from "./discovery.js";

export const COUNTER_PCT = 75n; // D9

export interface Deal {
  agentId: string | null;
  name: string;
  shop: string;
  quote_id: string;
  price_move: string;
  price_photo: string;
  payTo: string; // the seller's Hedera account (its agent wallet)
  x402: Record<string, string>; // start, move, photo, status, end
  chain?: Chain; // where its moves and photos are paid; Hedera when left out
  chainPayTo?: string; // the seller's address on that chain, as its card and its storefront both name it
}

/** The chain a deal is paid on, and the seller's address there. */
export const paidOn = (d: Deal): { chain: ChainInfo; payTo: string } => ({ chain: CHAINS[d.chain ?? "hedera"], payTo: d.chainPayTo ?? d.payTo });

/** The seller names `payTo` for this chain in a quote or an acceptance (its `pay` list; Hedera is its plain payTo). */
const names = (msg: any, chain: ChainInfo, payTo: string) => chain.chain === "hedera" ? msg.payTo === payTo
  : Array.isArray(msg.pay) && msg.pay.some((p: any) => p?.network === chain.network && p?.asset === chain.usdc && p?.payTo === payTo);

export interface Offer {
  agentId: string;
  name: string;
  quote_id: string | null;
  list: { move: string; photo: string };
  price_move: string | null;
  price_photo: string | null;
  meetsOffer: boolean;
  final: boolean;
  expected: string | null; // atomic USDC
  within_budget: boolean;
  error?: string;
}

export interface Negotiation {
  deal: Deal | null;
  offers: Offer[];
  declined: { agentId: string; reason: string }[];
  transcript: { agentId: string; from: "buyer" | "seller"; at: string; msg: unknown }[];
  transcript_sha256: string;
  summary: Record<string, unknown>; // compact, for the audit topic (HCS messages are at most 1 KB)
}

const counterPrice = (list: string) => ((BigInt(list) * COUNTER_PCT) / 100n).toString();

export async function negotiate(rovers: Rover[], o: { mission: string; photos: number; budget: bigint; estMoves: number; chain?: Chain },
                                say: (m: string) => void = () => undefined): Promise<Negotiation> {
  const chain = CHAINS[o.chain ?? "hedera"];
  const transcript: Negotiation["transcript"] = [];
  const talk = async (r: Rover, seller: Seller, msg: Record<string, unknown>) => {
    transcript.push({ agentId: r.agentId, from: "buyer", at: new Date().toISOString(), msg });
    const reply = await seller.say(msg);
    transcript.push({ agentId: r.agentId, from: "seller", at: new Date().toISOString(), msg: reply });
    return reply;
  };
  const sellers = new Map<string, Seller>();
  const offers: Offer[] = [];
  for (const r of rovers) {
    const offer: Offer = { agentId: r.agentId, name: r.name, quote_id: null, list: r.list, price_move: null, price_photo: null,
                           meetsOffer: false, final: false, expected: null, within_budget: false };
    offers.push(offer);
    try {
      const payTo = r.pay[chain.chain];
      if (!payTo) throw new Error(`takes no USDC on ${chain.label}`);
      const seller = await Seller.connect(r.shop);
      sellers.set(r.agentId, seller);
      const quote = await talk(r, seller, { type: "rfq", task: "parcel-inspection", mission: o.mission, photos: o.photos });
      if (quote.payTo !== r.payTo) throw new Error(`quote payTo ${quote.payTo} is not the card's ${r.payTo}`);
      if (!names(quote, chain, payTo)) throw new Error(`the quote does not name the card's ${chain.label} payTo ${payTo}`);
      offer.quote_id = quote.quote_id;
      const reply = await talk(r, seller, { type: "counter", quote_id: quote.quote_id,
                                            price_move: counterPrice(quote.price_move), price_photo: counterPrice(quote.price_photo) });
      Object.assign(offer, { price_move: reply.price_move, price_photo: reply.price_photo, meetsOffer: !!reply.meetsOffer, final: !!reply.final });
      const expected = BigInt(reply.price_move) * BigInt(o.estMoves) + BigInt(reply.price_photo) * BigInt(o.photos);
      offer.expected = expected.toString();
      offer.within_budget = expected <= o.budget;
      say(`${r.name} #${r.agentId}: ${usdcString(reply.price_move)}/move + ${usdcString(reply.price_photo)}/photo` +
          `${offer.meetsOffer ? " (meets our counter)" : offer.final ? " (final)" : ""}, expected ${usdcString(expected)} USDC`);
    } catch (e) {
      offer.error = (e as Error).message.slice(0, 160);
      say(`${r.name} #${r.agentId}: no usable offer (${offer.error})`);
    }
  }
  const rated = new Map(rovers.map((r) => [r.agentId, r.rating.value ?? -1]));
  const ranked = offers.filter((x) => x.expected !== null && x.within_budget)
    .sort((a, b) => Number(BigInt(a.expected!) - BigInt(b.expected!)) || rated.get(b.agentId)! - rated.get(a.agentId)!);
  const chosen = ranked[0] ?? null;
  const declined: Negotiation["declined"] = [];
  let deal: Deal | null = null;
  for (const x of offers) {
    if (x === chosen) continue;
    const reason = x.error ? `no usable offer: ${x.error}`
      : !x.within_budget ? `expected ${usdcString(x.expected!)} USDC is over the budget ${usdcString(o.budget)}`
      : `expected ${usdcString(x.expected!)} USDC is above ${chosen!.name}'s ${usdcString(chosen!.expected!)}`;
    declined.push({ agentId: x.agentId, reason });
    if (x.quote_id) await talk(rovers.find((r) => r.agentId === x.agentId)!, sellers.get(x.agentId)!, { type: "decline", quote_id: x.quote_id, reason })
      .catch((e) => say(`decline ${x.name}: ${(e as Error).message}`));
    say(`declined ${x.name} #${x.agentId}: ${reason}`);
  }
  if (chosen) {
    const r = rovers.find((v) => v.agentId === chosen.agentId)!;
    const acc = await talk(r, sellers.get(r.agentId)!, { type: "accept", quote_id: chosen.quote_id });
    if (acc.price_move !== chosen.price_move || acc.price_photo !== chosen.price_photo || acc.payTo !== r.payTo || !names(acc, chain, r.pay[chain.chain]!))
      throw new Error(`${r.name} accepted different terms than offered`);
    deal = { agentId: r.agentId, name: r.name, shop: r.shop, quote_id: acc.quote_id, price_move: acc.price_move, price_photo: acc.price_photo,
             payTo: acc.payTo, x402: acc.x402, ...(chain.chain === "hedera" ? {} : { chain: chain.chain, chainPayTo: r.pay[chain.chain]! }) };
    say(`chose ${r.name} #${r.agentId}: ${usdcString(acc.price_move)}/move + ${usdcString(acc.price_photo)}/photo, paid on ${chain.label}`);
  }
  const transcript_sha256 = createHash("sha256").update(JSON.stringify(transcript)).digest("hex");
  const summary = {
    type: "negotiation", mission_photos: o.photos, est_moves: o.estMoves, budget: o.budget.toString(), ...(chain.chain === "hedera" ? {} : { network: chain.network }),
    offers: offers.map((x) => ({ agent: x.agentId, move: x.price_move, photo: x.price_photo, expected: x.expected, final: x.final,
                                 meets: x.meetsOffer })),
    chosen: chosen?.agentId ?? null, quote_id: deal?.quote_id ?? null,
    declined: declined.map((d) => ({ agent: d.agentId, reason: d.reason.slice(0, 80) })), transcript_sha256,
  };
  return { deal, offers, declined, transcript, transcript_sha256, summary };
}


// Negotiation rule (D9): counter at 75% of list price.
// Accept the lowest expected total: price_move * EST_MOVES + price_photo * photos.
// Tie-break on reputation rating (higher = better).
// Log the rejection reason for every declined seller.
const COUNTER_FACTOR = 0.75;
const EST_MOVES = 13; // measured in P6

function expectedTotal(quote: Quote, photos: number): number {
  return quote.priceMove * EST_MOVES + quote.pricePhoto * photos;
}
