// Phase 13 (plan D23): the remote MCP's own buyer account, so remote missions never spend from the stable buyer.
// Created and funded by the stable buyer (ECDSA alias, associated with USDC), with its own spending topic (submit key:
// its own key). The key goes straight into scripts/p13/.env.buyer (0600) and is never printed. Idempotent.
// Usage: node scripts/setup-p13-buyer.ts <stable buyer .env>
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { mirror, operatorClient, parseKey, usdcAtomic, usdcBalance, USDC } from "@0xBs/hedera";
import { AccountCreateTransaction, Hbar, PrivateKey, TokenAssociateTransaction, TopicCreateTransaction, TransferTransaction } from "@hiero-ledger/sdk";
import { config } from "dotenv";

const START_HBAR = Number(process.env.START_HBAR ?? 10); // association, its spending topic and messages, ERC-8004 feedback
const START_USDC = "5"; // a few days of tests under the server's 2 USDC daily cap
const out = new URL("../../../scripts/p13/.env.buyer", import.meta.url).pathname;
const load = (path: string) => (existsSync(path) ? config({ path, quiet: true, processEnv: {} }).parsed ?? {} : {});
const stableEnvPath = process.argv[2];
if (!stableEnvPath || !existsSync(stableEnvPath)) throw new Error("usage: node scripts/setup-p13-buyer.ts <stable buyer .env>");
const stable = load(stableEnvPath);
const stableKey = parseKey(stable.HEDERA_BUYER_KEY, "HEDERA_BUYER_KEY");
const stableClient = operatorClient(stable.HEDERA_BUYER_ID!, stableKey);

let have = load(out);
if (!have.HEDERA_BUYER_ID) {
  const key = PrivateKey.generateECDSA();
  const rc = await (await new AccountCreateTransaction().setECDSAKeyWithAlias(key).setInitialBalance(new Hbar(START_HBAR))
    .execute(stableClient)).getReceipt(stableClient);
  const id = rc.accountId!.toString();
  writeFileSync(out, `HEDERA_BUYER_ID=${id}\nHEDERA_BUYER_KEY=${key.toStringRaw()}\nERC8004_FROM=${stable.ERC8004_FROM}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ step: "account", id, initial_hbar: START_HBAR }));
  have = load(out);
}
const id = have.HEDERA_BUYER_ID!;
const key = parseKey(have.HEDERA_BUYER_KEY, "remote HEDERA_BUYER_KEY");
const own = operatorClient(id, key);

if (!(await usdcBalance(id)).associated) {
  await (await new TokenAssociateTransaction().setAccountId(id).setTokenIds([USDC]).execute(own)).getReceipt(own);
  console.log(JSON.stringify({ step: "usdc associated", id }));
}
if (!have.P13_FUNDED) {
  const amount = Number(usdcAtomic(START_USDC));
  await (await new TransferTransaction().addTokenTransfer(USDC, stable.HEDERA_BUYER_ID!, -amount).addTokenTransfer(USDC, id, amount)
    .execute(stableClient)).getReceipt(stableClient);
  appendFileSync(out, "P13_FUNDED=1\n");
  console.log(JSON.stringify({ step: "usdc sent", from: stable.HEDERA_BUYER_ID, to: id, usdc: START_USDC }));
}
if (!have.HCS_SPEND_TOPIC) {
  const rc = await (await new TopicCreateTransaction().setTopicMemo("Rover for Hire, remote buyer spending (Phase 13)")
    .setSubmitKey(key.publicKey).execute(own)).getReceipt(own);
  appendFileSync(out, `HCS_SPEND_TOPIC=${rc.topicId!.toString()}\n`);
  console.log(JSON.stringify({ step: "spend topic", topic: rc.topicId!.toString() }));
}
const acct = await mirror(`/api/v1/accounts/${id}`);
console.log(JSON.stringify({ remote_buyer: id, evm: acct?.evm_address, hbar: acct ? acct.balance.balance / 1e8 : null,
                             usdc: Number((await usdcBalance(id)).balance) / 1e6, env_file: out }));
process.exit(0);
