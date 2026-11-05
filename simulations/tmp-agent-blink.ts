import "dotenv/config";
import {
  createSigner,
  wrapFetchWithPayment,
  decodeXPaymentResponse,
  type MultiNetworkSigner,
} from "x402-fetch";

const BASE_URL = process.env.DEVICE_CONTROLLER_URL ?? "http://localhost:4001";
const DEVICE_ID = "5ed4c654-7c17-41f3-9ac8-1bb95a8fa6a8";
const SERVICE_ID = "562f2b44-eaad-4090-be30-43e72160cf98"; // Blink LED (paid)

// 10 slow blinks — 5s of visible flashing, still inside the 10s reply timeout.
const PARAMS = { times: 10, onMs: 250, offMs: 250 };

const EVM_KEY_RAW = process.env.AGENT_EVM_PRIVATE_KEY?.trim();
if (!EVM_KEY_RAW || !/^0x[0-9a-fA-F]{64}$/.test(EVM_KEY_RAW)) {
  throw new Error("AGENT_EVM_PRIVATE_KEY missing or malformed in simulations/.env");
}

// This service only accepts Base, but the multi-network signer wants both
// families. The Solana key must be base58 — a hex key throws inside @scure/base.
const SOLANA_KEY = process.env.AGENT_SOLANA_PRIVATE_KEY?.trim();
if (!SOLANA_KEY) {
  throw new Error("AGENT_SOLANA_PRIVATE_KEY missing in simulations/.env");
}

const evm = await createSigner("base", EVM_KEY_RAW as `0x${string}`);
const svm = await createSigner("solana", SOLANA_KEY);
const wallet = { evm, svm } as MultiNetworkSigner;

console.log(`[agent] paying from ${evm.account.address}`);

// maxValue caps the auto-payment at 1 USDC atomic (6 decimals) so a bad quote
// can't drain the wallet.
const fetchWithPay = wrapFetchWithPayment(fetch, wallet, BigInt(1_000_000));

const url = `${BASE_URL}/quote/device/${DEVICE_ID}/service/${SERVICE_ID}`;
console.log(`[agent] POST ${url}`);
console.log(`[agent] params ${JSON.stringify(PARAMS)}`);

const started = Date.now();
const res = await fetchWithPay(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ params: PARAMS }),
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

if (!res.ok) {
  console.error(`[agent] ❌ failed (status ${res.status}) after ${elapsed}s`);
  console.error(await res.text());
  process.exit(1);
}

const receipt = res.headers.get("x-payment-response");
if (receipt) {
  const settlement = decodeXPaymentResponse(receipt);
  console.log(`[agent] ✅ settled on ${settlement.network}`);
  console.log(`[agent]    tx      ${settlement.transaction}`);
  console.log(`[agent]    payer   ${settlement.payer ?? "n/a"}`);
} else {
  console.log("[agent] ⚠️  no settlement header — was the service actually PAID?");
}

console.log(`[agent] device result (${elapsed}s):`, await res.json());
