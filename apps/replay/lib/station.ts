// Station-A's sales from public data only: its sales topic on the Hedera mirror node, where each message carries seq
// and prev = sha256 of the message before it, and each payment's own transaction on the chain that paid it: Hedera,
// Base Sepolia or Solana devnet (`network` on the sale; none means Hedera), read from each chain's public node.
import { CHAINS, chainOf, chainPayment, mirror, received } from "@0xBs/hedera/browser";
import { STATION } from "./config";

const GENESIS = "0".repeat(64);

/** The chain a sale was paid on, for its label and its explorer links. */
export function chainOfSale(s: Sale): { label: string; account: (a: string) => string } {
  const c = chainOf(s.network) ?? CHAINS.hedera;
  return { label: c.chain === "hedera" ? "Hedera" : c.label, account: c.accountUrl };
}

export interface Sale {
  n: number; // the message's seq on the topic, from 0
  ts: string; // consensus timestamp of the topic message
  type: string; // reading, motion or history
  amount: string; // USDC, atomic (6 decimals)
  payer: string;
  facilitator: string;
  tx: string; // the payment
  readingHash: string | null; // sha256 of the signed reading the buyer received
  network: string; // where it was paid
}

export interface Sales {
  sales: Sale[]; // newest first
  chain: { ok: boolean; brokenAt: number | null }; // seq and prev links, checked here
}

type Message = { consensus_timestamp: string; message: string };

const bytes = (b64: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Every sale on the topic, with the chain checked from the first message: seq counts up from 0 and each prev is the
 *  sha256 of the exact bytes of the message before it. */
export async function loadSales(): Promise<Sales> {
  const msgs: Message[] = [];
  let path: string | null = `/api/v1/topics/${STATION.topic}/messages?order=asc&limit=100`;
  while (path) {
    const d: { messages?: Message[]; links?: { next: string | null } } | null = await mirror(path);
    msgs.push(...(d?.messages ?? []));
    path = d?.links?.next ?? null;
  }
  const sales: Sale[] = [];
  let prev = GENESIS;
  let brokenAt: number | null = null;
  for (const [i, m] of msgs.entries()) {
    const raw = bytes(m.message);
    let j: Record<string, unknown> | null = null;
    try {
      j = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      j = null;
    }
    if (brokenAt === null && (!j || j.seq !== i || j.prev !== prev)) brokenAt = i;
    prev = await sha256(raw);
    if (!j) continue;
    sales.push({ n: i, ts: m.consensus_timestamp, type: String(j.type ?? "?"), amount: String(j.amount ?? "0"), payer: String(j.payer ?? ""),
      facilitator: String(j.facilitator ?? ""), tx: String(j.tx ?? ""), readingHash: typeof j.reading_hash === "string" ? j.reading_hash : null,
      network: typeof j.network === "string" ? j.network : "hedera:testnet" });
  }
  return { sales: sales.reverse(), chain: { ok: brokenAt === null, brokenAt } };
}

export interface PaymentCheck { ok: boolean; link: string; why: string | null }

/** The sale's payment as the chain that paid it recorded it: settled, and exactly this many USDC reached Station-A's address there. */
export async function checkPayment(s: Sale): Promise<PaymentCheck> {
  const c = chainOf(s.network) ?? CHAINS.hedera;
  const payTo = c.chain === "base" ? STATION.pay.base : c.chain === "solana" ? STATION.pay.solana : STATION.account;
  const p = await chainPayment(s.tx).catch(() => null);
  if (!p) return { ok: false, link: c.txUrl(s.tx), why: `not found on ${c.label}` };
  if (p.chain !== c) return { ok: false, link: p.link, why: `the transaction is on ${p.chain.label}, the sale says ${c.label}` };
  if (!p.ok) return { ok: false, link: p.link, why: `the transaction failed on ${c.label}` };
  const got = received(p, payTo);
  if (got !== BigInt(s.amount)) return { ok: false, link: p.link, why: `Station-A received ${got} not ${s.amount}` };
  return { ok: true, link: p.link, why: null };
}


// Station-A sales page: re-checks the HCS chain and verifies each payment
// on the chain that paid it (Hedera mirror, Base Sepolia explorer, or Solana RPC).
// Signature freshness: reject readings older than 10s (D17).
const MAX_READING_AGE_MS = 10_000;
export function isReadingFresh(ts: number): boolean {
  return Date.now() - ts < MAX_READING_AGE_MS;
}
