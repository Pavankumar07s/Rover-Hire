// Mirror node reads. Ledger checks here decide retries: a payment whose outcome is unknown is never re-signed
// until the mirror node shows it did not land.
import { MIRROR, USDC } from "./constants.js";

export async function mirror<T = any>(path: string): Promise<T | null> {
  const r = await fetch(MIRROR + path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`mirror node ${r.status} for ${path}`);
  return (await r.json()) as T;
}

export async function usdcBalance(accountId: string): Promise<{ associated: boolean; balance: bigint }> {
  const d = await mirror<{ tokens: { balance: number }[] }>(`/api/v1/accounts/${accountId}/tokens?token.id=${USDC}`);
  const t = d?.tokens?.[0];
  return t ? { associated: true, balance: BigInt(t.balance) } : { associated: false, balance: 0n };
}

/** "0.0.123@1700000000.000000001" → "0.0.123-1700000000-000000001" */
export const txIdToMirror = (txId: string): string => {
  if (!txId.includes("@")) return txId;
  const [acct, ts] = txId.split("@");
  return `${acct}-${ts!.replace(".", "-")}`;
};

export async function confirmTx(txId: string, timeoutMs = 25_000): Promise<any | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const d = await mirror<{ transactions: any[] }>(`/api/v1/transactions/${txIdToMirror(txId)}`).catch(() => null);
    if (d?.transactions?.[0]) return d.transactions[0];
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

/** A CRYPTOTRANSFER involving `accountId`, paid by this fee payer, after `sinceSec` (consensus seconds). */
export async function facilitatorTxSince(accountId: string, feePayer: string, sinceSec: number): Promise<any | null> {
  const d = await mirror<{ transactions: any[] }>(
    `/api/v1/transactions?account.id=${accountId}&timestamp=gt:${sinceSec.toFixed(9)}&order=desc&limit=25`);
  return d?.transactions?.find((t) => t.name === "CRYPTOTRANSFER" && t.transaction_id.startsWith(feePayer + "-")) ?? null;
}

export async function topicMessages(topicId: string, limit = 100, order: "asc" | "desc" = "asc"): Promise<{ seq: number; text: string; ts: string }[]> {
  const d = await mirror<{ messages: { sequence_number: number; message: string; consensus_timestamp: string }[] }>(
    `/api/v1/topics/${topicId}/messages?order=${order}&limit=${limit}`);
  return (d?.messages ?? []).map((m) => ({ seq: m.sequence_number, text: Buffer.from(m.message, "base64").toString("utf8"), ts: m.consensus_timestamp }));
}

export interface LedgerPayment {
  result: string; // "SUCCESS" when the transfer happened
  consensus: string; // seconds.nanos; HashScan opens a transaction by it
  usdc: { account: string; amount: bigint }[]; // USDC moved, atomic units (negative = paid out)
}

/** What the ledger itself says about a payment, by its transaction id. */
export async function ledgerPayment(txId: string): Promise<LedgerPayment | null> {
  const d = await mirror<{ transactions: any[] }>(`/api/v1/transactions/${txIdToMirror(txId)}`);
  const t = d?.transactions?.find((x) => x.name === "CRYPTOTRANSFER") ?? d?.transactions?.[0];
  if (!t) return null;
  return { result: t.result, consensus: t.consensus_timestamp,
           usdc: (t.token_transfers ?? []).filter((x: any) => x.token_id === USDC).map((x: any) => ({ account: x.account, amount: BigInt(x.amount) })) };
}
// 2026-11-06T11:18:00
// 2026-11-06T22:32:29


// Chunk ERC-8004 Registered event queries into <=7-day windows to avoid
// mirror node 400 errors on wide date ranges.
export function dateWindows(from: number, to: number, windowDays = 7) {
  const windows: Array<[number, number]> = [];
  const step = windowDays * 86400;
  for (let t = from; t < to; t += step)
    windows.push([t, Math.min(t + step, to)]);
  return windows;
}
