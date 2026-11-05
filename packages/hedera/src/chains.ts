// The chains a USDC payment can settle on (Phase 14): Hedera, and Base and Solana next to it. Testnets only, on purpose:
// a buyer refuses any other network, so a wallet holding real USDC is never spent. Identity and the record of every
// payment stay on Hedera (ERC-8004, HCS) whichever chain paid.
import { HASHSCAN, NETWORK, USDC } from "./constants.js";

export type Chain = "hedera" | "base" | "solana";

export interface ChainInfo {
  chain: Chain;
  network: `${string}:${string}`; // CAIP-2, as x402 names it
  label: string;
  usdc: string; // the USDC token (Hedera id, ERC-20 contract or SPL mint)
  extra?: Record<string, unknown>; // what the payer signs over: Base Sepolia USDC's own EIP-712 domain
  explorer: string; // the explorer txUrl and accountUrl open
  txUrl: (tx: string) => string;
  accountUrl: (account: string) => string;
}

export const CHAINS: Record<Chain, ChainInfo> = {
  hedera: { chain: "hedera", network: NETWORK, label: "Hedera testnet", usdc: USDC, explorer: "HashScan",
            txUrl: (tx) => `${HASHSCAN}/search-result?q=${encodeURIComponent(tx)}`, accountUrl: (a) => `${HASHSCAN}/account/${a}` },
  // Base Sepolia's USDC calls itself "USDC" (mainnet's is "USD Coin"): a wrong name makes every signature fail.
  base: { chain: "base", network: "eip155:84532", label: "Base Sepolia", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          extra: { name: "USDC", version: "2" }, explorer: "BaseScan",
          txUrl: (tx) => `https://sepolia.basescan.org/tx/${tx}`, accountUrl: (a) => `https://sepolia.basescan.org/address/${a}` },
  solana: { chain: "solana", network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", label: "Solana devnet", usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", explorer: "Solana Explorer",
            txUrl: (tx) => `https://explorer.solana.com/tx/${tx}?cluster=devnet`, accountUrl: (a) => `https://explorer.solana.com/address/${a}?cluster=devnet` },
};

/** The chain a network belongs to, or null for any network we do not pay on (every mainnet among them). */
export const chainOf = (network: string): ChainInfo | null => Object.values(CHAINS).find((c) => c.network === network) ?? null;

/** The chain a payment's transaction id comes from, by its shape: a Hedera transaction id (0.0.x@seconds.nanos), a Base
 *  transaction hash (0x + 64 hex) or a Solana signature (base58, 64 bytes). The rover and its records keep only the id. */
export function chainOfTx(tx: string): ChainInfo | null {
  if (/^\d+\.\d+\.\d+[@-]\d+[.-]\d+$/.test(tx)) return CHAINS.hedera;
  if (/^0x[0-9a-fA-F]{64}$/.test(tx)) return CHAINS.base;
  if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(tx)) return CHAINS.solana;
  return null;
}
