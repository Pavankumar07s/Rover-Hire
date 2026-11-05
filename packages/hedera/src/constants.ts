export const NETWORK = "hedera:testnet" as const;
export const USDC = "0.0.429274"; // Circle USDC on testnet, 6 decimals
export const USDC_DECIMALS = 6;
export const MIRROR = "https://testnet.mirrornode.hedera.com";
export const HASHSCAN = "https://hashscan.io/testnet";
export const HASHIO = "https://testnet.hashio.io/api"; // JSON-RPC, chain 296
// Writes go through the first relay that answers; reads use the mirror node (Hashio timed out for long spells).
export const EVM_RELAYS = [HASHIO, "https://296.rpc.thirdweb.com"];

export interface Facilitator {
  name: string;
  url: string;
  feePayer: string;
}

// Primary first (HANDOFF §11): failover order.
export const FACILITATORS: Facilitator[] = [
  { name: "blocky402", url: "https://api.testnet.blocky402.com", feePayer: "0.0.7162784" },
  { name: "x402.org", url: "https://x402.org/facilitator", feePayer: "0.0.9185802" },
];

export const ERC8004 = {
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  agentRegistry: "eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e",
} as const;

export const usdcAtomic = (usd: string | number): bigint => BigInt(Math.round(Number(usd) * 10 ** USDC_DECIMALS));
export const usdcString = (atomic: bigint | string | number): string =>
  (Number(atomic) / 10 ** USDC_DECIMALS).toFixed(USDC_DECIMALS).replace(/0+$/, "").replace(/\.$/, "");
// 2026-11-06T10:50:00
// 2026-11-06T23:05:37
