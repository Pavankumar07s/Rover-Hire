// Finds rovers for hire from ERC-8004 alone (plan Phase 7 task 3): every Registered event since ERC8004_FROM, the
// agent's current card, and the checks that make a seller payable: its card names this agentId in this registry, the
// registry's agentWallet is its payTo account, it is active on hedera:testnet in USDC, offers parcel-inspection, and
// its storefront answers with the same payTo. Reputation is the registry's summary over the agent's clients.
import { chainOf, ERC8004, mirror, NETWORK, readCard, registrationsSince, SKILL, USDC, view, type Chain } from "@0xBs/hedera";

export interface Rover {
  agentId: string;
  name: string;
  payTo: string;
  shop: string; // storefront base URL, from the card's A2A service
  body: string;
  list: { move: string; photo: string };
  rating: { count: number; value: number | null }; // "starred" feedback, 0-100
  checks: Record<string, boolean>;
  valid: boolean;
  reasons: string[];
  pay: Partial<Record<Chain, string>>; // where it can be paid: Hedera, plus each chain listed on BOTH its card and its storefront
}

export const evmOf = async (account: string): Promise<string | null> =>
  ((await mirror(`/api/v1/accounts/${account}`).catch(() => null)) as any)?.evm_address?.toLowerCase() ?? null;

type PayEntry = { network: string; asset: string; payTo: string };

async function storefront(a2aUrl: string): Promise<{ payTo: string | null; pay: PayEntry[] }> {
  try {
    const r = await fetch(a2aUrl, { signal: AbortSignal.timeout(10_000) }); // a remote storefront behind a tunnel on a weak network is slow
    if (!r.ok) return { payTo: null, pay: [] };
    const card: any = await r.json();
    const ext = card.capabilities?.extensions?.find((e: any) => e.params?.payTo);
    return { payTo: ext?.params?.payTo ?? null, pay: Array.isArray(ext?.params?.pay) ? ext.params.pay : [] };
  } catch {
    return { payTo: null, pay: [] };
  }
}

/** Hedera, plus every other chain whose payTo the card (on-chain, the seller's own word) and the live storefront both name. */
export function payable(x: { payTo?: string; accepts?: unknown }, front: PayEntry[]): Partial<Record<Chain, string>> {
  const pay: Partial<Record<Chain, string>> = x.payTo ? { hedera: x.payTo } : {};
  for (const a of Array.isArray(x.accepts) ? (x.accepts as any[]) : []) {
    const c = chainOf(String(a?.network ?? ""));
    if (!c || c.chain === "hedera" || a.asset !== c.usdc || typeof a.payTo !== "string") continue;
    if (front.some((p) => p.network === c.network && p.payTo === a.payTo && p.asset === c.usdc)) pay[c.chain] = a.payTo;
  }
  return pay;
}

export async function rating(agentId: string): Promise<Rover["rating"]> {
  // A plain copy: ethers' Result is frozen, and passing it back as an argument makes ethers try to write into it.
  const clients: string[] = [...(await view("reputation", "getClients", [agentId]))[0]];
  if (!clients.length) return { count: 0, value: null };
  const [count, value, decimals] = await view("reputation", "getSummary", [agentId, clients, "starred", ""]);
  return { count: Number(count), value: Number(count) ? Number(value) / 10 ** Number(decimals) : null };
}

async function inspect(agentId: string): Promise<Rover> {
  const reasons: string[] = [];
  const [[uri], [wallet]] = await Promise.all([view("identity", "tokenURI", [agentId]), view("identity", "getAgentWallet", [agentId])]);
  let card: any = {};
  try {
    card = await readCard(uri);
  } catch (e) {
    reasons.push(`card unreadable: ${(e as Error).message}`);
  }
  const x = card.x402 ?? {};
  const a2a = card.services?.find((s: any) => s.name === "A2A")?.endpoint ?? "";
  const [payToEvm, front] = await Promise.all([x.payTo ? evmOf(x.payTo) : null, a2a ? storefront(a2a) : { payTo: null, pay: [] }]);
  const checks: Record<string, boolean> = {
    registration: (card.registrations ?? []).some((r: any) => String(r.agentId) === agentId && r.agentRegistry === ERC8004.agentRegistry),
    agent_wallet_is_payto: !!payToEvm && String(wallet).toLowerCase() === payToEvm,
    active: card.active === true,
    network: x.network === NETWORK && x.asset === USDC,
    skill: (card.skills ?? []).includes(SKILL),
    storefront: !!a2a && front.payTo === x.payTo,
  };
  for (const [k, ok] of Object.entries(checks)) if (!ok) reasons.push(`check failed: ${k}`);
  return { agentId, name: card.name ?? `agent #${agentId}`, payTo: x.payTo ?? "", shop: a2a.replace(/\/\.well-known\/agent-card\.json$/, ""),
           body: x.body ?? "", list: { move: x.price?.move ?? "", photo: x.price?.photo ?? "" },
           rating: checks.registration ? await rating(agentId) : { count: 0, value: null }, checks, valid: reasons.length === 0, reasons,
           pay: payable(x, front.pay) };
}

/** Every agent registered since `fromSec`, checked; the caller keeps the valid ones and logs the rest with reasons. */
export async function findRovers(fromSec: number): Promise<Rover[]> {
  const regs = await registrationsSince(fromSec);
  return Promise.all([...new Set(regs.map((r) => r.agentId))].map(inspect));
}
// 2026-11-06T15:04:00
