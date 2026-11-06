// Did a Base or Solana payment we signed settle, although the seller's reply never said so (lost on the way, a 5xx, a
// 402 after a settle that timed out)? Read from the chain itself, so a retry never pays twice. Hedera has its own check
// (Payer.landedSince, through the mirror node).
import { CHAINS } from "@0xBs/hedera";

const BASE_RPC = "https://sepolia.base.org";
const SOLANA_RPC = "https://api.devnet.solana.com";
const AUTHORIZATION_USED = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5"; // USDC's AuthorizationUsed(address,bytes32)
const AUTHORIZATION_STATE = "0xe94a0102"; // authorizationState(address,bytes32)
const WAIT_MS = 20_000; // a settle the facilitator is still sending lands within this
const REFUSED_WAIT_MS = 5_000; // the seller answered that the settle failed: one more look is enough
const STEP_MS = 2_500;

async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10_000),
                               body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "rpc error");
  return j.result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // ERC-20 Transfer(address,address,uint256)
const word = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;

/** Base: the signed EIP-3009 authorization has a one-time nonce. USDC's own authorizationState(from, nonce) says whether it
 *  was spent; the transaction is then the one that emitted AuthorizationUsed(from, nonce), found in small block windows
 *  (Base's public node refuses wide log searches). */
async function onBase(payload: any): Promise<string | null> {
  const a = payload?.authorization;
  if (!a?.from || !a?.nonce) return null;
  const from = word(String(a.from));
  const nonce = String(a.nonce).toLowerCase();
  const spent = await rpc(BASE_RPC, "eth_call", [{ to: CHAINS.base.usdc, data: `${AUTHORIZATION_STATE}${from.slice(2)}${nonce.slice(2)}` }, "latest"]);
  if (BigInt(spent) === 0n) return null;
  const head = Number(await rpc(BASE_RPC, "eth_blockNumber", []));
  for (let to = head; to > head - 900; to -= 100) {
    const logs = await rpc(BASE_RPC, "eth_getLogs", [{ address: CHAINS.base.usdc, fromBlock: `0x${(to - 99).toString(16)}`, toBlock: `0x${to.toString(16)}`,
                                                       topics: [AUTHORIZATION_USED, from, nonce] }]);
    if ((logs as any[]).length) return (logs as any[])[0].transactionHash;
  }
  return `eip3009-nonce:${nonce}`; // spent for sure; its transaction is older than the window searched
}

/** A parsed Solana transaction moved exactly `amount` of USDC from `buyer` to `payTo` (by the owners' token balances). */
function solanaMoved(t: any, buyer: string, payTo: string, amount: bigint): boolean {
  const held = (key: string, owner: string) =>
    BigInt((t?.meta?.[key] ?? []).find((b: any) => b.mint === CHAINS.solana.usdc && b.owner === owner)?.uiTokenAmount?.amount ?? 0);
  return held("postTokenBalances", payTo) - held("preTokenBalances", payTo) === amount
    && held("preTokenBalances", buyer) - held("postTokenBalances", buyer) === amount;
}

/** Solana: the transaction's id exists only once the facilitator co-signs, so look for it among the buyer's own recent
 *  transactions: a successful one that moved exactly `amount` of USDC from the buyer to `payTo`. */
async function onSolana(buyer: string, payTo: string, amount: bigint, sinceSec: number): Promise<string | null> {
  const sigs = (await rpc(SOLANA_RPC, "getSignaturesForAddress", [buyer, { limit: 10, commitment: "confirmed" }])) as any[];
  for (const s of sigs.filter((x) => !x.err && (x.blockTime ?? 0) >= sinceSec - 5)) {
    const t = await rpc(SOLANA_RPC, "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
    if (solanaMoved(t, buyer, payTo, amount)) return s.signature;
  }
  return null;
}

/** A transaction the seller says paid us (its move_txs, photo_txs): true only if it succeeded and moved exactly `amount`
 *  of USDC from this buyer to `payTo` on that chain. */
export async function confirmElsewhere(network: string, tx: string, p: { buyer: string; payTo: string; amount: string }): Promise<boolean> {
  try {
    if (network === CHAINS.base.network) {
      const r = await rpc(BASE_RPC, "eth_getTransactionReceipt", [tx]);
      return r?.status === "0x1" && (r.logs as any[]).some((l) => l.address.toLowerCase() === CHAINS.base.usdc.toLowerCase()
        && l.topics[0] === TRANSFER && l.topics[1] === word(p.buyer) && l.topics[2] === word(p.payTo) && BigInt(l.data) === BigInt(p.amount));
    }
    if (network === CHAINS.solana.network) {
      const t = await rpc(SOLANA_RPC, "getTransaction", [tx, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
      return !!t && t.meta?.err === null && solanaMoved(t, p.buyer, p.payTo, BigInt(p.amount));
    }
  } catch {
    return false; // not readable yet: asked again on the next status
  }
  return false;
}

/** The transaction that settled this payment, or null when nothing moved: checked for up to 20 s when the answer was lost
 *  or timed out (the settle may still land), 5 s when the seller answered that the settle failed. */
export async function landedElsewhere(network: string, payload: unknown, p: { buyer: string; payTo: string; amount: string; sinceSec: number },
                                      settleRefused = false): Promise<string | null> {
  for (let waited = 0; waited <= (settleRefused ? REFUSED_WAIT_MS : WAIT_MS); waited += STEP_MS) {
    const tx = await (network === CHAINS.base.network ? onBase(payload)
      : network === CHAINS.solana.network ? onSolana(p.buyer, p.payTo, BigInt(p.amount), p.sinceSec)
      : Promise.resolve(null)).catch(() => null);
    if (tx) return tx;
    await sleep(STEP_MS);
  }
  return null;
}
