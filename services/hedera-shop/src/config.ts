// Per-seller settings from services/hedera-shop/.env.<SELLER> (a = Rover-A, the real rover).
import { config as loadEnv } from "dotenv";
import { CHAINS, usdcAtomic } from "@0xBs/hedera";

const seller = (process.env.SELLER ?? "a").trim();
loadEnv({ path: new URL(`../.env.${seller}`, import.meta.url).pathname, quiet: true });

const need = (name: string): string => {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set (services/hedera-shop/.env.${seller})`);
  return v;
};
const port = Number(process.env.PORT ?? (seller === "a" ? 8402 : 8403));
const testMode = process.env.SHOP_TEST_MODE === "1";
const sim = !process.env.ROVER_URL?.trim(); // no body to drive: quotes only (D1)
const priceFactor = testMode ? Number(process.env.PRICE_FACTOR_TEST ?? "1") : 1;
const usdc = (name: string, fallback?: string) => usdcAtomic(process.env[name]?.trim() || fallback || need(name)).toString();

export const cfg = {
  seller,
  name: process.env.SHOP_NAME ?? `Rover-${seller.toUpperCase()}`,
  port,
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
  sim,
  payTo: need("HEDERA_ROVER_ID"),
  // Phase 14: where else this seller is paid; a chain without an address here is not offered.
  basePayTo: process.env.ROVER_BASE_PAY_TO?.trim() || null,
  solanaPayTo: process.env.ROVER_SOLANA_PAY_TO?.trim() || null,
  roverKey: need("HEDERA_ROVER_KEY"),
  moneyTopic: sim ? "" : need("HCS_MONEY_TOPIC"),
  roverUrl: sim ? "" : need("ROVER_URL").replace(/\/$/, ""),
  roverToken: sim ? "" : need("ROVER_LAN_TOKEN"),
  prices: { move: usdc("PRICE_MOVE"), photo: usdc("PRICE_PHOTO") },
  // D5/D9: the lowest a counter can bring each price to; no floor set means the list price holds.
  floor: { move: usdc("PRICE_FLOOR_MOVE", process.env.PRICE_MOVE), photo: usdc("PRICE_FLOOR_PHOTO", process.env.PRICE_PHOTO) },
  testMode,
  // Test-only bait-and-switch on price: the 402 asks this factor times the agreed price. Ignored unless SHOP_TEST_MODE=1.
  priceFactor,
  // Test-only bait-and-switch: the 402 names another payTo than the quote. Ignored unless SHOP_TEST_MODE=1.
  testPayTo: testMode ? process.env.TEST_X402_PAYTO?.trim() || null : null,
};

/** Where this seller takes USDC: Hedera always, Base Sepolia and Solana devnet when it has an address there. */
export const PAY = [
  { chain: CHAINS.hedera, payTo: cfg.payTo },
  ...(cfg.basePayTo ? [{ chain: CHAINS.base, payTo: cfg.basePayTo }] : []),
  ...(cfg.solanaPayTo ? [{ chain: CHAINS.solana, payTo: cfg.solanaPayTo }] : []),
];
export const payList = () => PAY.map(({ chain, payTo }) => ({ network: chain.network, asset: chain.usdc, payTo }));
