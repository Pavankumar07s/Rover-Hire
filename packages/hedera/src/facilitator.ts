import type { Facilitator } from "./constants.js";
import { NETWORK } from "./constants.js";

export interface Health {
  ok: boolean;
  feePayer: string | null;
  ms: number;
  error?: string;
}

/** GET /supported must list hedera:testnet, scheme exact, x402 v2, with the fee payer we expect. */
export async function facilitatorHealth(f: Facilitator, timeoutMs = 5000): Promise<Health> {
  const t0 = performance.now();
  try {
    const r = await fetch(`${f.url}/supported`, { signal: AbortSignal.timeout(timeoutMs) });
    const j = (await r.json()) as { kinds?: { network: string; scheme: string; x402Version: number; extra?: { feePayer?: string } }[] };
    const k = j.kinds?.find((x) => x.network === NETWORK && x.scheme === "exact" && x.x402Version === 2);
    const feePayer = k?.extra?.feePayer ?? null;
    const ok = r.ok && feePayer === f.feePayer;
    return { ok, feePayer, ms: Math.round(performance.now() - t0), ...(ok ? {} : { error: k ? "unexpected fee payer" : "no hedera:testnet exact v2" }) };
  } catch (e) {
    return { ok: false, feePayer: null, ms: Math.round(performance.now() - t0), error: (e as Error).message };
  }
}
// 2026-11-06T11:46:00
// 2026-11-06T22:33:40


// Health check every 30s. On failure, switch to the backup facilitator
// and answer the next 402 request with a fresh payment requirement.
// Blocky402 is primary; x402.org is the fallback (fee payer 0.0.9185802).
export const FACILITATORS = [
  { url: process.env.BLOCKY402_URL ?? "https://blocky402.com", feePayer: null },
  { url: "https://x402.org", feePayer: "0.0.9185802" },
];
const HEALTH_CHECK_INTERVAL_MS = 30_000;
