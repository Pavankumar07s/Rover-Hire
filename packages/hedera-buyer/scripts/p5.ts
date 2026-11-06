// P5 acceptance helpers. Usage: node scripts/p5.ts <unpaid|photo99|hcs> [--seller URL] [--topic ID]
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import { HcsLog, NETWORK, operatorClient, parseKey, topicMessages, USDC, usdcAtomic, usdcBalance, usdcString, verifyHcsChain } from "@0xBs/hedera";
import { Payer, Seller } from "../dist/index.js";

loadEnv({ path: new URL("../.env", import.meta.url).pathname, quiet: true });
const { positionals, values } = parseArgs({ allowPositionals: true, options: { seller: { type: "string", default: "http://localhost:8402" }, topic: { type: "string" } } });
const EVIDENCE = new URL("../../../docs/rover/evidence/P5/", import.meta.url);
mkdirSync(EVIDENCE, { recursive: true });
const save = (name: string, data: unknown) => {
  writeFileSync(new URL(name, EVIDENCE), JSON.stringify({ at: new Date().toISOString(), ...(data as object) }, null, 2) + "\n");
  console.log(JSON.stringify(data, null, 2));
};

async function mission(photos = 0) {
  const seller = await Seller.connect(values.seller!);
  const quote = await seller.say({ type: "rfq", mission: "P5 test: no motion", photos_wanted: photos });
  const accepted = await seller.say({ type: "accept", quote_id: quote.quote_id });
  const r = await fetch(accepted.urls.start, { method: "POST" });
  if (!r.ok) throw new Error(`start: HTTP ${r.status} ${await r.text()}`);
  return { seller, quote, urls: accepted.urls as Record<string, string> };
}

const cmd = positionals[0];
if (cmd === "unpaid") {
  const { quote, urls } = await mission();
  const r = await fetch(urls.move!, { method: "POST" });
  const header = r.headers.get("payment-required");
  const pr = header ? JSON.parse(Buffer.from(header, "base64").toString("utf8")) : null;
  const a = pr?.accepts?.[0] ?? {};
  await fetch(urls.end!, { method: "POST" });
  const checks = {
    status_402: r.status === 402, scheme_exact: a.scheme === "exact", network: a.network === NETWORK, asset_usdc: a.asset === USDC,
    pay_to_rover_a: a.payTo === quote.pay_to, fee_payer: typeof a.extra?.feePayer === "string", upfront: a.extra?.paymentFlow === "upfront",
    amount_is_quote: a.amount === quote.move,
  };
  save("unpaid_402.json", { quote_id: quote.quote_id, status: r.status, payment_required: pr, checks, pass: Object.values(checks).every(Boolean) });
} else if (cmd === "photo99") {
  const buyerId = process.env.HEDERA_BUYER_ID!;
  const key = parseKey(process.env.HEDERA_BUYER_KEY, "HEDERA_BUYER_KEY");
  const log = await HcsLog.open(operatorClient(buyerId, key), process.env.HCS_SPEND_TOPIC!);
  const payer = new Payer(buyerId, process.env.HEDERA_BUYER_KEY!, { capPerPayment: "$0.20", budget: usdcAtomic("0.80"), perMerchant: usdcAtomic("0.80"), approvalThreshold: usdcAtomic("0.50") }, log);
  const { seller, quote, urls } = await mission(1);
  const before = await usdcBalance(buyerId);
  const r = await payer.pay(urls.photo!.replace("{n}", "99"), { kind: "photo", merchant: seller.base, payTo: quote.pay_to, amount: quote.photo });
  const body = r.response ? await r.response.text() : null;
  await fetch(urls.end!, { method: "POST" });
  await new Promise((res) => setTimeout(res, 8000)); // mirror node lag
  const after = await usdcBalance(buyerId);
  const checks = { not_ok: !r.ok, server_error: (r.status ?? 0) >= 500, no_tx: r.tx === null, balance_unchanged: before.balance === after.balance };
  save("photo99_not_charged.json", { quote_id: quote.quote_id, status: r.status, body: body?.slice(0, 200), tx: r.tx, ms: r.ms,
                                     buyer_usdc_before: usdcString(before.balance), buyer_usdc_after: usdcString(after.balance), checks,
                                     pass: Object.values(checks).every(Boolean) });
} else if (cmd === "hcs") {
  const msgs = await topicMessages(values.topic!, 100);  // P5 topics stay under 100 messages
  const chain = verifyHcsChain(msgs.map((m) => m.text));
  const parsed = msgs.map((m) => JSON.parse(m.text));
  save(`hcs_${values.topic}.json`, { topic: values.topic, count: msgs.length, chain, max_bytes: Math.max(...msgs.map((m) => Buffer.byteLength(m.text))),
                                     messages: parsed });
} else {
  console.error("usage: node scripts/p5.ts <unpaid|photo99|hcs>");
}
process.exit(0);
