import "dotenv/config";
import {
  wrapFetchWithPaymentFromConfig,
  decodePaymentResponseHeader,
} from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { ExactSvmScheme } from "@x402/svm";
import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { privateKeyToAccount } from "viem/accounts";
import type { SchemeRegistration } from "@x402/fetch";
import { DEVICE_ID, SERVICE_ID } from "./config.js";

// ── Config ────────────────────────────────────────────────────────────────
// The v2 counterpart of agent.ts. Same endpoint, same device, different
// protocol generation: agent.ts uses `x402-fetch` (v1, network NAMES, pays via
// `X-PAYMENT`), while this uses `@x402/fetch` (v2, CAIP-2 networks, pays via
// `PAYMENT-SIGNATURE`). The server advertises both on every 402, so neither
// buyer needs anything bespoke.
//
// Override the target to hit a different service:
//   DEVICE_ID=… SERVICE_ID=… npm run agent:v2
const BASE_URL = process.env.DEVICE_CONTROLLER_URL ?? "http://localhost:4001";

//   AGENT_EVM_PRIVATE_KEY    — 0x-prefixed hex, pays EVM networks
//   AGENT_SOLANA_PRIVATE_KEY — base58 secret, pays Solana networks
const EVM_KEY = process.env.AGENT_EVM_PRIVATE_KEY?.trim();
const SOLANA_KEY = process.env.AGENT_SOLANA_PRIVATE_KEY?.trim();

// Solana mainnet + Base mainnet CAIP-2 ids, which is how v2 names networks.
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const BASE_MAINNET = "eip155:8453";

async function main() {
  // Schemes are registered per network, by CAIP-2 id. Registration is also what
  // scopes the buyer: the server may offer Polygon or Arbitrum too, but only the
  // networks listed here are payable. A service quotes in whichever family its
  // payout wallet belongs to, so register both to handle either.
  const schemes: SchemeRegistration[] = [];

  if (EVM_KEY && /^0x[0-9a-fA-F]{64}$/.test(EVM_KEY)) {
    const account = privateKeyToAccount(EVM_KEY as `0x${string}`);
    schemes.push({ network: BASE_MAINNET, client: new ExactEvmScheme(account) });
    console.log(`[agent-v2] EVM  ${account.address}`);
  }

  if (SOLANA_KEY) {
    // @solana/kit wants the raw 64-byte secret; the env var is base58.
    const bytes = getBase58Encoder().encode(SOLANA_KEY);
    const signer = await createKeyPairSignerFromBytes(new Uint8Array(bytes));
    schemes.push({ network: SOLANA_MAINNET, client: new ExactSvmScheme(signer) });
    console.log(`[agent-v2] SVM  ${signer.address}`);
  }

  if (schemes.length === 0) {
    throw new Error(
      "Set AGENT_EVM_PRIVATE_KEY and/or AGENT_SOLANA_PRIVATE_KEY to pay for a service",
    );
  }

  const fetchWithPay = wrapFetchWithPaymentFromConfig(fetch, {
    schemes,
    // Caps each payment. USDC is a recognised default asset on both families, so
    // it needs no `allowedAssets` entry; a non-default token would.
    spendControls: { maxAmountPerPayment: "$0.10" },
  });

  const url = `${BASE_URL}/quote/device/${DEVICE_ID}/service/${SERVICE_ID}`;
  const params = process.env.PARAMS
    ? JSON.parse(process.env.PARAMS)
    : { seconds: 1 };
  console.log(`[agent-v2] POST ${url}`);
  console.log(`[agent-v2] params`, params);

  const res = await fetchWithPay(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params }),
  });

  if (!res.ok) {
    console.error(`[agent-v2] request failed (status ${res.status})`);
    console.error(await res.text());
    process.exit(1);
  }

  // v2 settles into `PAYMENT-RESPONSE`; the v1 `X-PAYMENT-RESPONSE` is still
  // sent alongside it. A free service returns neither.
  const receipt =
    res.headers.get("payment-response") ??
    res.headers.get("x-payment-response");
  if (receipt) {
    const settlement = decodePaymentResponseHeader(receipt);
    console.log(
      `[agent-v2] settled on ${settlement.network} — tx ${settlement.transaction}`,
    );
  } else {
    console.log("[agent-v2] no payment was required (free service)");
  }

  console.log("[agent-v2] result:", await res.json());
}

main().catch((err) => {
  console.error("[agent-v2] error:", err);
  process.exit(1);
});
