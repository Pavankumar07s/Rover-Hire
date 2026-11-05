// A Base or Solana settle that the facilitator calls failed or pending is checked on the chain before the shop answers 402.
// The Solana cases use real devnet transactions from a mission at the event, where x402.org answered "settlement_pending"
// (its node was rate-limited) for transfers that had landed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfirmOnChain } from "../dist/payments.js";

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const ROVER_A = "GaHBtss84gr2xvmY9gVy4XydioVh5nFwU2Rv8cDAih58";
const LANDED_MOVE = "2WYgu3FB2FGytNLJZLzwnuEJQiH9Lrg9QjPJ8rwk49tvZ6yYPRNi7TYaHxnMjXNDQbJDJojg6PKhr8s8zBArJYZM"; // 0.015 USDC to Rover-A
const LANDED_PHOTO = "5w5zuD81TrM6VmfECk634vcsvhGH16KZa84bY4KMcQC7rcELc4YfKMiBM2EFLrxhwYQGsoa3k4yGVu3qWsf7D1mL"; // 0.06 USDC to Rover-A

const req = (network: string, amount: string, payTo: string) =>
  ({ scheme: "exact", network, amount, asset: "x", payTo, maxTimeoutSeconds: 60, extra: {} }) as any;
const payload = (r: any) => ({ x402Version: 2, accepted: r, payload: { transaction: "signed-by-the-buyer" } }) as any;

/** The facilitator's answer as it came back; the chain check that follows is real. */
class Answered extends ConfirmOnChain {
  answer: any;
  calls = 0;
  constructor(answer: any, waitMs = 4_000) {
    super({ url: "http://127.0.0.1:9" });
    this.answer = answer;
    this.waitMs = waitMs;
  }
  upstream() {
    this.calls++;
    return Promise.resolve(this.answer);
  }
}

const pending = (transaction: string, network = SOLANA) =>
  ({ success: false, errorReason: "settlement_pending", errorMessage: "Too Many Requests", transaction, network, payer: "DrYqLHb5btinWAvZyuHQMf5picrR5AVN9SxmyFxDwPou" });

test("Solana 'settlement_pending' for a transfer that landed: settled, with that transaction", async () => {
  const r = req(SOLANA, "15000", ROVER_A);
  const s = await new Answered(pending(LANDED_MOVE)).settle(payload(r), r);
  assert.equal(s.success, true);
  assert.equal(s.transaction, LANDED_MOVE);
  assert.equal(s.payer, "DrYqLHb5btinWAvZyuHQMf5picrR5AVN9SxmyFxDwPou");
});

test("a landed transfer of another amount does not count for this payment", async () => {
  const r = req(SOLANA, "15000", ROVER_A); // the move's price, but the transaction paid a photo (60000)
  const s = await new Answered(pending(LANDED_PHOTO)).settle(payload(r), r);
  assert.equal(s.success, false);
});

test("a landed transfer to someone else does not count either", async () => {
  const r = req(SOLANA, "15000", "Afr4bRMcWpTPemgKGbVqUjBXyQaxuK6u5L32sGWsPVLM"); // Station-A's address
  const s = await new Answered(pending(LANDED_MOVE)).settle(payload(r), r);
  assert.equal(s.success, false);
});

test("a pending transaction that never lands stays a failure, after the wait", async () => {
  const r = req(SOLANA, "15000", ROVER_A);
  const t = Date.now();
  const s = await new Answered(pending("1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111"), 3_000).settle(payload(r), r);
  assert.equal(s.success, false);
  assert.ok(Date.now() - t >= 2_500, "it kept checking the chain before giving up");
});

test("Hedera failures and every success pass through unchanged, without reading any chain", async () => {
  const h = req("hedera:testnet", "15000", "0.0.11327287");
  const failed = { success: false, errorReason: "invalid_transaction", transaction: "", network: "hedera:testnet" };
  assert.deepEqual(await new Answered(failed).settle(payload(h), h), failed);
  const ok = { success: true, transaction: LANDED_MOVE, network: SOLANA, payer: "p" };
  const r = req(SOLANA, "15000", ROVER_A);
  assert.deepEqual(await new Answered(ok).settle(payload(r), r), ok);
});
