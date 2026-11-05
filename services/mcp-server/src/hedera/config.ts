// Rover for Hire settings for the MCP server. The buyer's key stays where the user entered it
// (packages/hedera-buyer/.env); this process reads that file and never prints a key.
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = process.env.HEDERA_BUYER_ENV ?? resolve(packageRoot, "../../packages/hedera-buyer/.env");
// On a host with no env file (Render, Phase 13), the same names come from the process environment.
const env = existsSync(envPath) ? loadEnv({ path: envPath, quiet: true, processEnv: {} }).parsed ?? {} : { ...process.env };

export const hederaEnvPath = envPath;
export const maxBudgetUsdc = process.env.HEDERA_MAX_BUDGET_USDC ?? "1.00"; // no mission can be given more
export const stationMaxPayment = process.env.STATION_MAX_PAYMENT_USDC ?? "0.02"; // D16: one station payment
export const stationCallBudget = process.env.STATION_CALL_BUDGET_USDC ?? "0.05"; // D16: one sensor tool call
export const estMoves = Number(env.EST_MOVES ?? "20"); // 5-photo missions with a scan first: 18-26 moves (a live run: 26)
export const zgLogUrl = (process.env.ZG_LOG_URL ?? env.ZG_LOG_URL ?? "http://localhost:8787").replace(/\/+$/, "");

/** Throws with the file to fix when the buyer is not set up, so the tool can say so. */
export function buyerEnv() {
  const need = (k: string) => {
    const v = env[k]?.trim();
    if (!v) throw new Error(`${k} is not set in ${envPath}`);
    return v;
  };
  return { buyerId: need("HEDERA_BUYER_ID"), keyRaw: need("HEDERA_BUYER_KEY"), erc8004From: Number(need("ERC8004_FROM")),
           spendTopic: env.HCS_SPEND_TOPIC?.trim() || null, auditTopic: env.AUDIT_TOPIC?.trim() || null };
}

// Public 0G endpoints for the report's links (Galileo testnet for storage and EpisodeLog, mainnet for 0G Compute).
export const zgIndexer = process.env.ZG_INDEXER_URL ?? "https://indexer-storage-testnet-turbo.0g.ai";
export const galileoExplorer = "https://chainscan-galileo.0g.ai";
export const mainnetExplorer = "https://chainscan.0g.ai";
export const replayUrl = (process.env.REPLAY_URL ?? "https://rover-replay.vercel.app").replace(/\/+$/, "");
