// Phase 14: paying a seller on Hedera, Base Sepolia or Solana devnet. What the buyer accepts as another chain's payTo, which
// option of a 402 it signs, and how a lost reply on another chain is matched to the seller's record.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { test } from "node:test";
import { CHAINS, chainOfTx } from "@0xBs/hedera";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { payable } from "../dist/discovery.js";
import { reconcile } from "../dist/mission.js";
import { paidOn, type Deal } from "../dist/negotiate.js";
import { Payer } from "../dist/payer.js";

const BASE_PAYTO = "0x79C515a8fC8A6E6cf65636dd163772f4C5204ce1";
const SOL_PAYTO = "GaHBtss84gr2xvmY9gVy4XydioVh5nFwU2Rv8cDAih58";
const entry = (c: typeof CHAINS.base, payTo: string) => ({ network: c.network, asset: c.usdc, payTo });

test("another chain counts only when the card and the storefront name the same payTo", () => {
  const card = { payTo: "0.0.11327287", accepts: [entry(CHAINS.base, BASE_PAYTO), entry(CHAINS.solana, SOL_PAYTO)] };
  assert.deepEqual(payable(card, [entry(CHAINS.base, BASE_PAYTO), entry(CHAINS.solana, SOL_PAYTO)]),
                   { hedera: "0.0.11327287", base: BASE_PAYTO, solana: SOL_PAYTO });
  // the storefront names another Base address: Base is dropped, Solana stays
  assert.deepEqual(payable(card, [entry(CHAINS.base, "0x0000000000000000000000000000000000000001"), entry(CHAINS.solana, SOL_PAYTO)]),
                   { hedera: "0.0.11327287", solana: SOL_PAYTO });
  // only on the storefront, not on the card: not payable there
  assert.deepEqual(payable({ payTo: "0.0.11327287" }, [entry(CHAINS.base, BASE_PAYTO)]), { hedera: "0.0.11327287" });
});

test("a mainnet or a wrong token on the card is never payable", () => {
  const mainnet = { network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: BASE_PAYTO };
  const wrongToken = { ...entry(CHAINS.base, BASE_PAYTO), asset: "0x0000000000000000000000000000000000000002" };
  for (const a of [mainnet, wrongToken]) assert.deepEqual(payable({ payTo: "0.0.1", accepts: [a] }, [a]), { hedera: "0.0.1" });
});

test("a payment's chain is read from the shape of its transaction id", () => {
  assert.equal(chainOfTx("0.0.7162784@1793900000.123456789"), CHAINS.hedera);
  assert.equal(chainOfTx(`0x${"ab".repeat(32)}`), CHAINS.base);
  assert.equal(chainOfTx("5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW"), CHAINS.solana);
  assert.equal(chainOfTx("0.0.11327287"), null);
});

test("a deal is paid on its chain, at the seller's address there", () => {
  const deal: Deal = { agentId: "137", name: "Rover-A", shop: "http://x", quote_id: "a-1", price_move: "1", price_photo: "2", payTo: "0.0.11327287", x402: {} };
  assert.deepEqual(paidOn(deal), { chain: CHAINS.hedera, payTo: "0.0.11327287" });
  assert.deepEqual(paidOn({ ...deal, chain: "base", chainPayTo: BASE_PAYTO }), { chain: CHAINS.base, payTo: BASE_PAYTO });
});

test("a Base move whose reply was lost is matched to the seller's record once its chain confirms it", async () => {
  const tx = `0x${"cd".repeat(32)}`;
  const payments: any[] = [{ ok: true, tx: `0x${"01".repeat(32)}`, kind: "move", status: 200, refused: null, ms: 1 },
                           { ok: false, tx: null, kind: "move", status: null, refused: null, ms: 1, error: "fetch failed" }];
  const asked: string[] = [];
  const open = await reconcile(payments, { move_txs: [payments[0].tx, tx] }, async (t) => (asked.push(t), true));
  assert.equal(open, 0);
  assert.deepEqual(asked, [tx]); // the one already paid is not asked again
  assert.equal(payments[1].ok, true);
  assert.equal(payments[1].tx, tx);
  assert.equal(payments[1].lost, true);
});

/** A seller that answers every request with one 402 offering `accepts`, and records which option a paid retry signed. */
async function seller(accepts: Record<string, unknown>[]): Promise<{ url: string; signed: () => any; close: () => void }> {
  let signed: any = null;
  const server = http.createServer((req, res) => {
    const header = req.headers["payment-signature"];
    if (header) {
      signed = decodePaymentSignatureHeader(String(header));
      res.writeHead(200, { "content-type": "application/json" }).end("{}"); // no settle: nothing is paid
      return;
    }
    const required = { x402Version: 2, error: "payment required", resource: { url: `http://${req.headers.host}${req.url}`, description: "test", mimeType: "" }, accepts };
    res.writeHead(402, { "content-type": "application/json", "payment-required": Buffer.from(JSON.stringify(required)).toString("base64") }).end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/missions/q/move`, signed: () => signed, close: () => server.close() };
}

const option = (c: typeof CHAINS.base, payTo: string, amount = "15000", network: string = c.network) =>
  ({ scheme: "exact", network, amount, asset: c.usdc, payTo, maxTimeoutSeconds: 60, extra: { ...(c.extra ?? {}), paymentFlow: "upfront" } });

async function payer(): Promise<Payer> {
  const p = new Payer("0.0.11326806", randomBytes(32).toString("hex"), { capPerPayment: "$0.20", budget: 1_000_000n, perMerchant: 1_000_000n,
                                                                         approvalThreshold: 500_000n }, null);
  return p.addChains({ evm: `0x${randomBytes(32).toString("hex")}` });
}

test("the buyer signs only the chain it was asked to pay on, at the quoted payTo", async () => {
  const s = await seller([option(CHAINS.hedera, "0.0.11327287"), option(CHAINS.base, BASE_PAYTO), option(CHAINS.solana, SOL_PAYTO)]);
  try {
    const r = await (await payer()).pay(s.url, { kind: "move", merchant: "m", payTo: BASE_PAYTO, amount: "15000", network: CHAINS.base.network });
    assert.equal(r.refused, null);
    assert.equal(s.signed()?.accepted?.network, CHAINS.base.network);
    assert.equal(s.signed()?.accepted?.payTo, BASE_PAYTO);
  } finally {
    s.close();
  }
});

test("a 402 whose payTo on the asked chain is not the quoted one is refused, and nothing is signed", async () => {
  const s = await seller([option(CHAINS.hedera, "0.0.11327287"), option(CHAINS.base, "0x0000000000000000000000000000000000000003")]);
  try {
    const r = await (await payer()).pay(s.url, { kind: "move", merchant: "m", payTo: BASE_PAYTO, amount: "15000", network: CHAINS.base.network });
    assert.match(r.refused ?? "", /payTo 0x0+3 is not the quoted/);
    assert.equal(s.signed(), null);
  } finally {
    s.close();
  }
});

test("a mainnet option is never signed, even at the right payTo and price", async () => {
  const s = await seller([option(CHAINS.base, BASE_PAYTO, "15000", "eip155:8453")]);
  try {
    const r = await (await payer()).pay(s.url, { kind: "move", merchant: "m", payTo: BASE_PAYTO, amount: "15000", network: CHAINS.base.network });
    assert.match(r.refused ?? "", /not USDC on Base Sepolia/);
    assert.equal(s.signed(), null);
  } finally {
    s.close();
  }
});

test("asked for Solana while the seller offers only Hedera and Base: refused, nothing signed", async () => {
  const s = await seller([option(CHAINS.hedera, "0.0.11327287"), option(CHAINS.base, BASE_PAYTO)]);
  try {
    const r = await (await payer()).pay(s.url, { kind: "move", merchant: "m", payTo: SOL_PAYTO, amount: "15000", network: CHAINS.solana.network });
    assert.match(r.refused ?? "", /not USDC on Solana devnet/);
    assert.equal(s.signed(), null);
  } finally {
    s.close();
  }
});
