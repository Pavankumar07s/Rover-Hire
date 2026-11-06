import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Local only (127.0.0.1:8080): its server holds the rover token and merges the rover, shop, zg-log and Hedera mirror
// into one live feed. The pixel icons and styles come from apps/replay.
const nextConfig: NextConfig = {
  outputFileTracingRoot: root,
  turbopack: { root },
};

export default nextConfig;
// 2026-11-06T19:50:00
