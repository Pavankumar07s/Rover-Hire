import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// MCP clients launch this process from an arbitrary working directory, so the
// .env has to be located relative to the package rather than to `process.cwd()`.
// `quiet` matters: dotenv v17 prints a banner, and anything on stdout corrupts
// the JSON-RPC stream the MCP client is reading.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(packageRoot, ".env"), quiet: true });

export const DEVICE_CONTROLLER_URL = (
  process.env.DEVICE_CONTROLLER_URL ?? "https://device-controller.0xbs.org"
).replace(/\/+$/, "");

/** USDC is 6-decimal everywhere x402 supports it. */
const USDC_DECIMALS = 6n;
const USDC_SCALE = 10n ** USDC_DECIMALS;

/**
 * "0.01" / "$0.01" → 10000n. Parsed as a decimal string rather than via
 * parseFloat, because binary floats can't represent cents exactly and this
 * number authorises a real transfer.
 */
export function usdcToAtomic(amount: string): bigint {
  const cleaned = amount.trim().replace(/^\$/, "");
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(cleaned);
  if (!match) {
    throw new Error(
      `"${amount}" is not a USDC amount (digits with up to 6 decimal places)`,
    );
  }
  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? "").padEnd(Number(USDC_DECIMALS), "0"));
  return whole * USDC_SCALE + fraction;
}

/** 10000n → "0.01", for showing humans and models real amounts. */
export function atomicToUsdc(atomic: bigint | string | number): string {
  const value = BigInt(atomic);
  const whole = value / USDC_SCALE;
  const fraction = (value % USDC_SCALE)
    .toString()
    .padStart(Number(USDC_DECIMALS), "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/**
 * Hard ceiling on any single automatic payment. This is the only thing standing
 * between a mispriced service (or a compromised one) and the wallet, so it is
 * read once at startup and a per-call limit may lower it but never raise it.
 */
export const MAX_PAYMENT_ATOMIC = usdcToAtomic(
  process.env.MAX_PAYMENT_USDC ?? "0.10",
);
// 2026-11-06T18:24:00
