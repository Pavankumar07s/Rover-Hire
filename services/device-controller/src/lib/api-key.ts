import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Generate a per-device API key.
 * Format: `bs_<40 hex chars>` — prefixed so it's easy to recognise in logs.
 */
export function generateApiKey(): string {
  return `bs_${randomBytes(20).toString("hex")}`;
}

/** SHA-256 hash of an API key — this is what we persist, never the raw key. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Constant-time compare of a raw key against the stored hash. */
export function apiKeyMatches(raw: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(raw), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A masked, non-secret reference for display, e.g. "bs_1a2b3c…7f8e". */
export function previewApiKey(key: string): string {
  return `${key.slice(0, 9)}…${key.slice(-4)}`;
}

/**
 * Create the fields to persist for a freshly minted key, plus the raw key to
 * return to the client exactly once.
 */
export function mintApiKey() {
  const raw = generateApiKey();
  return {
    raw,
    apiKeyHash: hashApiKey(raw),
    apiKeyPreview: previewApiKey(raw),
  };
}

/** Supported payout chains — mirrors the Prisma `WalletChain` enum. */
export type WalletChain = "BASE" | "SOLANA";

export function isWalletChain(value: unknown): value is WalletChain {
  return value === "BASE" || value === "SOLANA";
}

/**
 * Validate a Base (EVM) wallet address: 0x followed by 40 hex characters.
 * Returns the normalized (lowercased) address, or null if invalid.
 */
export function normalizeWallet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  return /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null;
}

/** Base58 alphabet used by Solana addresses (no 0, O, I, l). */
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Validate a Solana wallet address: a base58 public key, 32–44 chars.
 * Returns the address unchanged (base58 is case-sensitive), or null.
 */
export function normalizeSolanaWallet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  return SOLANA_RE.test(v) ? v : null;
}

/** Chain-aware wallet validation. */
export function normalizeWalletForChain(
  value: unknown,
  chain: WalletChain,
): string | null {
  return chain === "SOLANA"
    ? normalizeSolanaWallet(value)
    : normalizeWallet(value);
}
