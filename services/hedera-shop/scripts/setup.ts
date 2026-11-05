// P5 setup, part 1: check both accounts against their keys, USDC association and balances; create the rover
// money topic (submit key Rover-A) and the buyer spending topic (submit key buyer) if missing; save their ids.
// Usage: node scripts/setup.ts   (reads .env.a and packages/hedera-buyer/.env)
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { mirror, operatorClient, parseKey, usdcBalance, usdcString } from "@0xBs/hedera";
import { TopicCreateTransaction, type PrivateKey } from "@hiero-ledger/sdk";
import { config } from "dotenv";

const shopEnv = new URL("../.env.a", import.meta.url).pathname;
const buyerEnv = new URL("../../../packages/hedera-buyer/.env", import.meta.url).pathname;
const shop = config({ path: shopEnv, quiet: true, processEnv: {} }).parsed ?? {};
const buyer = config({ path: buyerEnv, quiet: true, processEnv: {} }).parsed ?? {};

async function account(label: string, id: string, key: PrivateKey) {
  const info = await mirror(`/api/v1/accounts/${id}`);
  if (!info) throw new Error(`${label} ${id} not found on the mirror node`);
  const onchain = (info.key?.key ?? "").toLowerCase();
  const usdc = await usdcBalance(id);
  const row = { label, id, evm: info.evm_address, key_type: info.key?._type ?? null, key_matches: onchain === key.publicKey.toStringRaw().toLowerCase(),
                hbar: info.balance.balance / 1e8, usdc_associated: usdc.associated, usdc: usdcString(usdc.balance) };
  console.log(JSON.stringify(row));
  if (!row.key_matches) throw new Error(`${label}: the key in the env file is not ${id}'s key`);
  if (!row.usdc_associated) throw new Error(`${label}: USDC 0.0.429274 is not associated`);
  return row;
}

async function topic(label: string, id: string, key: PrivateKey, memo: string, envFile: string, envName: string, existing?: string) {
  if (existing) return { label, topic: existing, created: false };
  const client = operatorClient(id, key);
  const receipt = await (await new TopicCreateTransaction().setSubmitKey(key.publicKey).setTopicMemo(memo).execute(client)).getReceipt(client);
  const topicId = receipt.topicId!.toString();
  appendFileSync(envFile, `${envName}=${topicId}\n`);
  console.log(`${label}: created ${topicId} (submit key ${id}), saved as ${envName}`);
  return { label, topic: topicId, created: true };
}

const roverId = shop.HEDERA_ROVER_ID!, buyerId = buyer.HEDERA_BUYER_ID!;
const roverKey = parseKey(shop.HEDERA_ROVER_KEY, "HEDERA_ROVER_KEY"), buyerKey = parseKey(buyer.HEDERA_BUYER_KEY, "HEDERA_BUYER_KEY");
const accounts = [await account("buyer", buyerId, buyerKey), await account("rover-a", roverId, roverKey)];
const topics = [
  await topic("rover money topic", roverId, roverKey, "0xBs rover money log (Rover-A)", shopEnv, "HCS_MONEY_TOPIC", shop.HCS_MONEY_TOPIC),
  await topic("buyer spending topic", buyerId, buyerKey, "0xBs buyer x402 spending log", buyerEnv, "HCS_SPEND_TOPIC", buyer.HCS_SPEND_TOPIC),
];
const dir = process.env.SETUP_EVIDENCE_DIR
  ? pathToFileURL(process.env.SETUP_EVIDENCE_DIR.replace(/\/?$/, "/")) // a setup run can keep its record outside the evidence folders
  : new URL("../../../docs/rover/evidence/P5/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL(process.env.SETUP_EVIDENCE_DIR ? "setup-topics.json" : "setup.json", dir), JSON.stringify({ at: new Date().toISOString(), accounts, topics }, null, 2) + "\n");
console.log(JSON.stringify({ ok: true, topics }));
process.exit(0); // the Hedera client keeps its gRPC channels open
// 2026-11-06T13:54:00
// 2026-11-06T17:20:00
