// ERC-8004 on Hedera testnet (registries v2.0.0, HANDOFF): agent cards (plan §3.7), registration, discovery from
// Registered events, reputation. Writes go through Hashio (~8-12 s each), so never inside the motion loop.
import type { PrivateKey } from "@hiero-ledger/sdk";
import { ethers } from "ethers";
import { ERC8004, EVM_RELAYS, HASHIO, MIRROR, NETWORK, USDC } from "./constants.js";
import { mirror } from "./mirror.js";

export const IDENTITY_ABI = [
  "function register(string agentURI, (string metadataKey, bytes metadataValue)[] metadata) returns (uint256)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];
export const REPUTATION_ABI = [
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function getLastIndex(uint256 agentId, address clientAddress) view returns (uint64)",
  "function getClients(uint256 agentId) view returns (address[])",
];
export const SKILL = "parcel-inspection";
const WINDOW_S = 7 * 86400 - 1; // the mirror node answers log queries over at most 7 days

export const provider = (url: string = HASHIO) => new ethers.JsonRpcProvider(url, 296, { staticNetwork: true });
export const evmWallet = (key: PrivateKey, url: string = HASHIO) => new ethers.Wallet("0x" + key.toStringRaw(), provider(url));

/** The first EVM relay that answers within 4 s, for writes. */
export async function liveRelay(): Promise<string> {
  for (const url of EVM_RELAYS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(4000),
                                   body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (r.ok && (await r.json())?.result === "0x128") return url;
    } catch {
      // try the next relay
    }
  }
  return HASHIO;
}

const IFACES = { identity: new ethers.Interface(IDENTITY_ABI), reputation: new ethers.Interface(REPUTATION_ABI) };

/** A view call through the mirror node (no JSON-RPC relay involved), decoded with the registry ABI. */
export async function view(registry: "identity" | "reputation", method: string, args: unknown[]): Promise<ethers.Result> {
  const iface = IFACES[registry];
  return readRetry(async () => {
    const r = await fetch(`${MIRROR}/api/v1/contracts/call`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ to: ERC8004[registry], data: iface.encodeFunctionData(method, args), estimate: false, block: "latest" }),
    });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j?.result) throw new Error(`mirror node ${r.status} for ${method}: ${JSON.stringify(j?._status ?? j).slice(0, 160)}`);
    return iface.decodeFunctionResult(method, j.result);
  });
}
export const identity = (runner: ethers.ContractRunner = provider()) => new ethers.Contract(ERC8004.identity, IDENTITY_ABI, runner);
export const reputation = (runner: ethers.ContractRunner = provider()) => new ethers.Contract(ERC8004.reputation, REPUTATION_ABI, runner);

/** Retries a read on transient relay/mirror errors (Hashio answers 502 now and then). Never used for writes. */
export async function readRetry<T>(read: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await read();
    } catch (e: any) {
      const transient = ["SERVER_ERROR", "TIMEOUT", "NETWORK_ERROR"].includes(e?.code) || e?.name === "TimeoutError" ||
                        /mirror node 5\d\d|fetch failed/i.test(e?.message ?? "");
      if (!transient || i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

export interface CardInput {
  name: string;
  description: string;
  shop: string; // storefront base URL
  payTo: string; // the agent's own Hedera account
  move: string; // atomic USDC
  photo: string;
  body: "arduino-uno-q" | "simulated";
  agentId?: string;
  accepts?: { network: string; asset: string; payTo: string }[]; // Phase 14: where else it is paid (Base Sepolia, Solana devnet)
}

/** Plan §3.7, registration-v1. `registrations` is empty until the agentId exists. */
export function agentCard(c: CardInput) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: c.name,
    description: c.description,
    services: [
      { name: "A2A", endpoint: `${c.shop}/.well-known/agent-card.json`, version: "1.0" },
      { name: "x402", endpoint: `${c.shop}/missions/{quoteId}/move` },
    ],
    x402Support: true,
    active: true,
    x402: { network: NETWORK, asset: USDC, payTo: c.payTo, price: { move: c.move, photo: c.photo }, body: c.body,
            ...(c.accepts?.length ? { accepts: c.accepts } : {}) },
    skills: [SKILL],
    supportedTrust: ["reputation"],
    registrations: c.agentId ? [{ agentId: Number(c.agentId), agentRegistry: ERC8004.agentRegistry }] : [],
  };
}
export type AgentCard = ReturnType<typeof agentCard>;

// Phase 12: a sensor station sells signed readings at fixed list prices (D16): no A2A haggling, so no A2A service.
export const STATION_SKILLS = ["climate-reading", "light-level", "motion-events"];
export interface StationCardInput {
  name: string;
  description: string;
  shop: string;
  payTo: string;
  signer: string; // the station's own signing address (D17)
  reading: string; // atomic USDC
  motion: string;
  historyPerMin: string;
  pressure: boolean; // false while the pressure element is faulty
  agentId?: string;
  accepts?: { network: string; asset: string; payTo: string }[]; // Phase 14: where else it is paid (Base Sepolia, Solana devnet)
}
export function stationCard(c: StationCardInput) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: c.name,
    description: c.description,
    services: [
      { name: "info", endpoint: `${c.shop}/station/info` },
      { name: "x402", endpoint: `${c.shop}/station/reading` },
    ],
    x402Support: true,
    active: true,
    x402: { network: NETWORK, asset: USDC, payTo: c.payTo, price: { reading: c.reading, motion: c.motion, history_per_min: c.historyPerMin },
            body: "arduino-uno-q", ...(c.accepts?.length ? { accepts: c.accepts } : {}) },
    skills: STATION_SKILLS,
    signer: c.signer,
    units: { temp: "centi-°C", rh: "centi-%RH", pressure: c.pressure ? "Pa" : "not available (sensor fault)",
             light: "relative % (LDR, not lux): 0 = covered, 100 = a torch against it" },
    supportedTrust: ["reputation"],
    registrations: c.agentId ? [{ agentId: Number(c.agentId), agentRegistry: ERC8004.agentRegistry }] : [],
  };
}
export type StationCard = ReturnType<typeof stationCard>;

export const cardUri = (card: object): string => "data:application/json;base64," + Buffer.from(JSON.stringify(card)).toString("base64");

/** `data:` and `https:` cards only. */
export async function readCard(uri: string): Promise<any> {
  if (uri.startsWith("data:")) {
    const comma = uri.indexOf(",");
    const meta = uri.slice(5, comma), body = uri.slice(comma + 1);
    return JSON.parse(meta.endsWith(";base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body));
  }
  if (uri.startsWith("https://")) {
    const r = await fetch(uri, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`card ${uri}: HTTP ${r.status}`);
    return r.json();
  }
  throw new Error(`card URI scheme not allowed: ${uri.slice(0, 16)}`);
}

export interface Sent { hash: string; gasUsed: string; gasLimit: string; feeHbar: number; receipt: ethers.TransactionReceipt }

/** Hedera bills at least 80 % of the gas limit, so the limit is 1.2 x the estimate. */
export async function send(contract: ethers.Contract, method: string, args: unknown[]): Promise<Sent> {
  const fn = contract.getFunction(method);
  const gasLimit = ((await fn.estimateGas(...args)) * 12n) / 10n;
  const tx = await fn(...args, { gasLimit });
  const receipt = (await tx.wait())!;
  if (receipt.status !== 1) throw new Error(`${method} reverted: ${tx.hash}`);
  const feeHbar = Number(receipt.gasUsed * (receipt.gasPrice ?? 0n)) / 1e18;
  return { hash: tx.hash, gasUsed: receipt.gasUsed.toString(), gasLimit: gasLimit.toString(), feeHbar, receipt };
}

/** Registers from the agent's own wallet, so the registry sets agentWallet = msg.sender = its payTo. */
export async function register(wallet: ethers.Wallet, card: object, hederaAccount: string): Promise<Sent & { agentId: string }> {
  const id = identity(wallet);
  const meta = [{ metadataKey: "hederaAccount", metadataValue: ethers.toUtf8Bytes(hederaAccount) }];
  const sent = await send(id, "register", [cardUri(card), meta]);
  const ev = sent.receipt.logs.map((l) => { try { return id.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "Registered");
  if (!ev) throw new Error(`no Registered event in ${sent.hash}`);
  return { ...sent, agentId: ev.args.agentId.toString() };
}

export interface Registration { agentId: string; owner: string; uri: string; timestamp: string }

/** Every Registered event since `fromSec`, read from the mirror node in windows of at most 7 days. */
export async function registrationsSince(fromSec: number, toSec = Math.floor(Date.now() / 1000)): Promise<Registration[]> {
  const iface = new ethers.Interface(IDENTITY_ABI);
  const topic0 = iface.getEvent("Registered")!.topicHash;
  const out: Registration[] = [];
  for (let start = fromSec; start <= toSec; start += WINDOW_S + 1) {
    const end = Math.min(start + WINDOW_S, toSec);
    let path: string | null = `/api/v1/contracts/${ERC8004.identity}/results/logs?topic0=${topic0}` +
      `&timestamp=gte:${start}&timestamp=lte:${end}.999999999&order=asc&limit=100`;
    while (path) {
      const url: string = path;
      const page: any = await readRetry(() => mirror(url));
      for (const log of page?.logs ?? []) {
        const ev = iface.parseLog({ topics: log.topics, data: log.data });
        if (ev) out.push({ agentId: ev.args.agentId.toString(), owner: ev.args.owner, uri: ev.args.agentURI, timestamp: log.timestamp });
      }
      path = page?.links?.next ?? null;
    }
  }
  return out;
}
// 2026-11-06T12:00:00
// 2026-11-06T17:34:00
// 2026-11-06T22:53:47


// Verify that registrations[].agentRegistry matches the expected
// IdentityRegistry address (0x8004A818BFB912233c491871b3d84c89A494BD9e).
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export function verifyRegistration(card: AgentCard): boolean {
  return card.registrations?.some(
    r => r.agentRegistry.toLowerCase() === IDENTITY_REGISTRY.toLowerCase()
  ) ?? false;
}
