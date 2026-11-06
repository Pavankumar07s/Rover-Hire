// P7 acceptance checks that need no rover (plan Phase 7). Run from packages/hedera-buyer after `npm run build`:
//   node scripts/p7.ts permissions   staticCall from the real accounts: the buyer edits Rover-A's card; Rover-A rates itself
//   node scripts/p7.ts guards        Agent Kit: a raw HBAR transfer, and a payment over the mission budget
//   node scripts/p7.ts audit <tx>…   the audit topic holds a hook entry for each payment tx given
import { config } from "dotenv";
import { evmWallet, identity, parseKey, reputation, topicMessages } from "@0xBs/hedera";
import { BuyerAgent, PAY_TOOL } from "../dist/agentkit.js";
import { Payer } from "../dist/payer.js";

const env = config({ path: new URL("../.env", import.meta.url).pathname, quiet: true, processEnv: {} }).parsed ?? {};
const roverA = config({ path: new URL("../../../services/hedera-shop/.env.a", import.meta.url).pathname, quiet: true, processEnv: {} }).parsed ?? {};
const why = (e: any) => e?.reason ?? e?.shortMessage ?? e?.message ?? String(e);
const out: Record<string, unknown> = {};

if (process.argv[2] === "permissions") {
  const agentA = roverA.ERC8004_AGENT_ID!;
  const buyer = evmWallet(parseKey(env.HEDERA_BUYER_KEY, "HEDERA_BUYER_KEY"));
  const rover = evmWallet(parseKey(roverA.HEDERA_ROVER_KEY, "HEDERA_ROVER_KEY"));
  try {
    await identity(buyer).getFunction("setAgentURI").staticCall(agentA, "data:,hijack");
    out.buyer_edits_card = "ALLOWED (bad)";
  } catch (e) {
    out.buyer_edits_card = `refused: ${why(e)}`;
  }
  try {
    await reputation(rover).getFunction("giveFeedback").staticCall(agentA, 100, 0, "starred", "", "", "", "0x" + "00".repeat(32));
    out.rover_rates_itself = "ALLOWED (bad)";
  } catch (e) {
    out.rover_rates_itself = `refused: ${why(e)}`;
  }
  out.pass = /Not authorized/i.test(String(out.buyer_edits_card)) && /Self-feedback not allowed/i.test(String(out.rover_rates_itself));
} else if (process.argv[2] === "guards") {
  const payer = new Payer(env.HEDERA_BUYER_ID!, env.HEDERA_BUYER_KEY!, { capPerPayment: "$0.20", budget: 0n, perMerchant: 0n, approvalThreshold: 0n }, null);
  const agent = new BuyerAgent(env.HEDERA_BUYER_ID!, env.HEDERA_BUYER_KEY!, payer, 0n, env.AUDIT_TOPIC ?? null);
  const raw = await agent.run("transfer_hbar_tool", { transfers: [{ accountId: roverA.HEDERA_ROVER_ID, amount: 0.01 }] });
  out.raw_hbar_transfer = { status: raw.raw?.status, message: raw.humanMessage };
  const over = await agent.run(PAY_TOOL, { id: "guard-test", url: "http://localhost:8402/missions/none/move", kind: "move", merchant: "test",
                                           payTo: roverA.HEDERA_ROVER_ID!, amount: "15000" });
  out.over_budget_payment = { status: over.raw?.status, message: over.humanMessage };
  out.pass = raw.raw?.status === "ERROR" && over.raw?.status === "ERROR" && /polic/i.test(over.humanMessage);
} else if (process.argv[2] === "audit") {
  const txs = process.argv.slice(3);
  const msgs = await topicMessages(env.AUDIT_TOPIC!, 100, "desc");
  const texts = msgs.map((m) => m.text);
  out.audit_topic = env.AUDIT_TOPIC;
  out.messages_read = texts.length;
  out.found = Object.fromEntries(txs.map((t) => [t, texts.some((s) => s.includes(PAY_TOOL) && s.includes(t))]));
  out.pass = txs.length > 0 && Object.values(out.found as Record<string, boolean>).every(Boolean);
} else {
  console.error("usage: node scripts/p7.ts permissions | guards | audit <tx>…");
  process.exit(2);
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);
