function envUrl(name: string, fallback: string) {
  const value = process.env[name];
  return (value ?? fallback).replace(/\/$/, "");
}

function consoleOrigin() {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return envUrl("NEXT_PUBLIC_APP_URL", "");
  }
  if (process.env.NEXT_PUBLIC_VERCEL_ENV) {
    return "";
  }
  return "http://localhost:3000";
}

function docsOrigin() {
  if (process.env.NEXT_PUBLIC_DOCS_URL) {
    return envUrl("NEXT_PUBLIC_DOCS_URL", "");
  }
  if (process.env.NEXT_PUBLIC_VERCEL_ENV) {
    return "/docs";
  }
  return "http://localhost:3001";
}

export const site = {
  app: consoleOrigin(),
  docs: docsOrigin(),
  api: envUrl(
    "NEXT_PUBLIC_DEVICE_CONTROLLER_URL",
    "https://device-controller.0xbs.org",
  ),
  x402: "https://www.x402.org",
  sdk: "https://github.com/abhinav-genx/0xBs-sdk",
  tweet: "https://x.com/AbhinavGenX/status/2091192093154988077",
  tx: "https://basescan.org/tx/0xfa081a6df7c1fea2cc71f0b8a088eb2cc35dbb566b129559e66c6090a26da178",
} as const;

export const routes = {
  login: `${site.app}/login`,
  signup: `${site.app}/signup`,
} as const;
