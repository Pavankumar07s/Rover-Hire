import "dotenv/config";
import { generatePrivateKey } from "viem/accounts";
import {
  createSigner,
  wrapFetchWithPayment,
  decodeXPaymentResponse,
  type MultiNetworkSigner,
} from "x402-fetch";
import { DEVICE_ID, SERVICE_ID } from "./config.js";

// ── Config ────────────────────────────────────────────────────────────────
// The device-controller now speaks STANDARD x402 (the same wire format as any
// public x402 endpoint), so this agent is just an ordinary x402-fetch buyer:
// wrap fetch, and it transparently handles the 402 -> pay -> retry loop.
const BASE_URL = process.env.DEVICE_CONTROLLER_URL ?? "http://localhost:4001";

// One key per wallet family, so the buyer can pay on whichever chain the server
// offers. Both fall back to a throwaway (can sign, but settlement needs funds).
//   AGENT_EVM_PRIVATE_KEY    — 0x-prefixed hex (all EVM networks)
//   AGENT_SOLANA_PRIVATE_KEY — base58 secret (all Solana networks)
const EVM_KEY_RAW = process.env.AGENT_EVM_PRIVATE_KEY?.trim() || undefined;
const SOLANA_KEY = process.env.AGENT_SOLANA_PRIVATE_KEY?.trim() || undefined;
const EVM_KEY = (
  EVM_KEY_RAW && /^0x[0-9a-fA-F]{64}$/.test(EVM_KEY_RAW)
    ? EVM_KEY_RAW
    : generatePrivateKey()
) as `0x${string}`;

async function main() {
  const url = `${BASE_URL}/quote/device/${DEVICE_ID}/service/${SERVICE_ID}`;
  const body = JSON.stringify({ params: { room: "100", floor: "5" } });

  // A multi-network signer lets x402-fetch pay on either family. `createSigner`
  // takes a v1 network NAME purely to pick the key type: hex -> EVM signer,
  // base58 -> Solana signer. The actual pay-network is chosen per-request from
  // the server's `accepts`.
  const evm = await createSigner("base", EVM_KEY);
  const svm = await createSigner("solana", SOLANA_KEY ?? generatePrivateKey());
  const wallet = { evm, svm } as MultiNetworkSigner;

  // Wrap fetch. maxValue caps what we'll auto-pay (atomic USDC, 6 decimals);
  // 1 USDC here. x402-fetch parses the 402, signs, and retries automatically.
  const fetchWithPay = wrapFetchWithPayment(fetch, wallet, BigInt(1_000_000));

  console.log(`[agent] POST ${url}`);
  const res = await fetchWithPay(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (!res.ok) {
    console.error(`[agent] request failed (status ${res.status})`);
    console.error(await res.text());
    process.exit(1);
  }

  // Settlement receipt (if a payment happened) + the device result.
  const xpr = res.headers.get("x-payment-response");
  if (xpr) {
    const settlement = decodeXPaymentResponse(xpr);
    console.log(
      `[agent] ✅ settled on ${settlement.network} — tx ${settlement.transaction}`,
    );
  }
  console.log("[agent] result:", await res.json());
}

main().catch((err) => {
  console.error("[agent] error:", err);
  process.exit(1);
});
