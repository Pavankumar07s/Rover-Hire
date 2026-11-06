// Server only. The rover URL and token come from Rover-A's shop env, the topic ids from the shop and buyer envs, so no
// secret is copied; the token never leaves this process.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "../..");

export type Role = "shop" | "buyer" | "audit";

function readEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const shop = readEnv(process.env.HUD_SHOP_ENV ?? path.join(ROOT, "services/hedera-shop/.env.a"));
const buyer = readEnv(process.env.HUD_BUYER_ENV ?? path.join(ROOT, "packages/hedera-buyer/.env"));

export const config = {
  roverUrl: (process.env.ROVER_URL ?? shop.ROVER_URL ?? "http://rovera.local:8700").replace(/\/+$/, ""),
  roverToken: process.env.ROVER_LAN_TOKEN ?? shop.ROVER_LAN_TOKEN ?? "",
  // IP literals: a lookup of the offline rover's .local name holds one of Node's few DNS threads for ~5 s.
  shopUrl: (process.env.SHOP_URL ?? `http://127.0.0.1:${shop.PORT ?? 8402}`).replace(/\/+$/, ""),
  zgLogUrl: (process.env.ZG_LOG_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, ""),
  topics: [
    { role: "shop", name: "Shop payments", topic: shop.HCS_MONEY_TOPIC },
    { role: "buyer", name: "Buyer spending", topic: buyer.HCS_SPEND_TOPIC },
    { role: "audit", name: "Negotiation audit", topic: buyer.AUDIT_TOPIC },
  ].filter((t): t is { role: Role; name: string; topic: string } => !!t.topic),
};

export const roverHeaders = () => ({ "X-Rover-Token": config.roverToken });
// 2026-11-06T19:36:00
