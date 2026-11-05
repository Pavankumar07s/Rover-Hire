// One payment read back from the chain that settled it, by its transaction id alone: Hedera through the mirror node, Base
// Sepolia and Solana devnet through their public nodes. Plain fetch, so the browser (replay, station pages) runs it too.
import { chainOfTx, CHAINS, type ChainInfo } from "./chains.js";
import { HASHSCAN } from "./constants.js";
import { ledgerPayment } from "./mirror.js";

const RPC = { base: "https://sepolia.base.org", solana: "https://api.devnet.solana.com" };
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // ERC-20 Transfer(address,address,uint256)

export interface ChainPayment {
  chain: ChainInfo;
  ok: boolean; // the transaction succeeded
  at: number; // when it settled, unix seconds (Hedera's consensus time, the Base block's or the Solana block's time)
  usdc: { account: string; amount: bigint }[]; // USDC moved by owner, atomic (negative = paid out); EVM addresses lower-case
  link: string; // the transaction on its chain's explorer
}

async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? `${method} failed`);
  return j.result;
}

const add = (moves: Map<string, bigint>, account: string, amount: bigint) => moves.set(account, (moves.get(account) ?? 0n) + amount);
const list = (moves: Map<string, bigint>) => [...moves].filter(([, a]) => a !== 0n).map(([account, amount]) => ({ account, amount }));

async function onBase(tx: string): Promise<ChainPayment | null> {
  const r = await rpc(RPC.base, "eth_getTransactionReceipt", [tx]);
  if (!r) return null;
  const block = await rpc(RPC.base, "eth_getBlockByNumber", [r.blockNumber, false]);
  const moves = new Map<string, bigint>();
  for (const l of r.logs ?? []) {
    if (String(l.address).toLowerCase() !== CHAINS.base.usdc.toLowerCase() || l.topics?.[0] !== TRANSFER) continue;
    const amount = BigInt(l.data);
    add(moves, `0x${String(l.topics[1]).slice(26)}`, -amount);
    add(moves, `0x${String(l.topics[2]).slice(26)}`, amount);
  }
  return { chain: CHAINS.base, ok: r.status === "0x1", at: Number(block.timestamp), usdc: list(moves), link: CHAINS.base.txUrl(tx) };
}

async function onSolana(tx: string): Promise<ChainPayment | null> {
  const t = await rpc(RPC.solana, "getTransaction", [tx, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
  if (!t) return null;
  const moves = new Map<string, bigint>();
  const usdc = (b: any) => b.mint === CHAINS.solana.usdc && b.owner;
  for (const b of (t.meta?.preTokenBalances ?? []).filter(usdc)) add(moves, b.owner, -BigInt(b.uiTokenAmount.amount));
  for (const b of (t.meta?.postTokenBalances ?? []).filter(usdc)) add(moves, b.owner, BigInt(b.uiTokenAmount.amount));
  return { chain: CHAINS.solana, ok: t.meta?.err === null, at: Number(t.blockTime), usdc: list(moves), link: CHAINS.solana.txUrl(tx) };
}

/** The payment `tx` as its own chain recorded it, or null when that chain has no such transaction (yet). */
export async function chainPayment(tx: string): Promise<ChainPayment | null> {
  const chain = chainOfTx(tx);
  if (chain === CHAINS.base) return onBase(tx);
  if (chain === CHAINS.solana) return onSolana(tx);
  const p = await ledgerPayment(tx);
  return p && { chain: CHAINS.hedera, ok: p.result === "SUCCESS", at: Number(p.consensus), usdc: p.usdc, link: `${HASHSCAN}/transaction/${p.consensus}` };
}

/** USDC that `account` received in this payment (EVM addresses compared without case). */
export const received = (p: ChainPayment, account: string): bigint =>
  p.usdc.filter((u) => u.account.toLowerCase() === account.toLowerCase() && u.amount > 0n).reduce((a, u) => a + u.amount, 0n);

/** The USDC an address holds on Base Sepolia or Solana devnet, atomic (0 when it has no USDC account yet). */
export async function usdcOn(chain: "base" | "solana", address: string): Promise<bigint> {
  if (chain === "base") {
    const word = address.slice(2).toLowerCase().padStart(64, "0");
    return BigInt(await rpc(RPC.base, "eth_call", [{ to: CHAINS.base.usdc, data: `0x70a08231${word}` }, "latest"])); // balanceOf(address)
  }
  const r = await rpc(RPC.solana, "getTokenAccountsByOwner", [address, { mint: CHAINS.solana.usdc }, { encoding: "jsonParsed" }]);
  return (r?.value ?? []).reduce((a: bigint, v: any) => a + BigInt(v.account.data.parsed.info.tokenAmount.amount), 0n);
}

const AUTHORIZATION_USED = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5"; // USDC's AuthorizationUsed(address,bytes32)
const AUTHORIZATION_STATE = "0xe94a0102"; // authorizationState(address,bytes32)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Base: the transaction that spent this signed EIP-3009 authorization (its one-time nonce), or null while it is unspent.
 *  The authorization fixes payer, payee and amount, so a spent nonce is exactly this payment. */
export async function authorizationTx(authorization: { from?: string; nonce?: string } | undefined): Promise<string | null> {
  if (!authorization?.from || !authorization.nonce) return null;
  const from = `0x${authorization.from.slice(2).toLowerCase().padStart(64, "0")}`;
  const nonce = authorization.nonce.toLowerCase();
  const spent = await rpc(RPC.base, "eth_call", [{ to: CHAINS.base.usdc, data: `${AUTHORIZATION_STATE}${from.slice(2)}${nonce.slice(2)}` }, "latest"]);
  if (BigInt(spent) === 0n) return null;
  const head = Number(await rpc(RPC.base, "eth_blockNumber", []));
  for (let to = head; to > head - 900; to -= 100) { // Base's public node refuses wide log searches
    const logs = (await rpc(RPC.base, "eth_getLogs", [{ address: CHAINS.base.usdc, fromBlock: `0x${(to - 99).toString(16)}`,
                                                         toBlock: `0x${to.toString(16)}`, topics: [AUTHORIZATION_USED, from, nonce] }])) as any[];
    if (logs.length) return logs[0].transactionHash;
  }
  return null;
}

/** A Base or Solana settle that came back failed or pending (a facilitator that timed out, or was rate-limited while it
 *  confirmed): the transaction that paid it if the payment landed anyway, checked on the chain for up to `waitMs`, else
 *  null. Solana: the signature the facilitator reported, confirmed and moving exactly `amount` to `payTo`. Base: the
 *  authorization's one-time nonce spent. */
export async function settledAnyway(network: string, p: { payload: any; signature?: string; payTo: string; amount: string },
                                    waitMs = 30_000): Promise<string | null> {
  for (let waited = 0; ; waited += 2_500) {
    try {
      if (network === CHAINS.base.network) {
        const tx = await authorizationTx(p.payload?.authorization);
        if (tx) return tx;
      } else if (network === CHAINS.solana.network && p.signature) {
        const c = await chainPayment(p.signature);
        if (c && c.chain === CHAINS.solana) return c.ok && received(c, p.payTo) === BigInt(p.amount) ? p.signature : null; // landed; failed or wrong: no
      } else return null;
    } catch {
      // the node did not answer: ask again
    }
    if (waited >= waitMs) return null;
    await sleep(2_500);
  }
}
