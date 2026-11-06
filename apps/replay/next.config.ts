import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

// A static export: the page only reads public chains and storage, so it needs no server of ours.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  outputFileTracingRoot: path.join(appDir, "../.."),
};

export default nextConfig;
// 2026-11-06T20:42:00
