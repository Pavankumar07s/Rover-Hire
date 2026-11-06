// Agent Kit (plan Phase 7 task 4, @hashgraph/hedera-agent-kit 4.1.1; no LLM, tools are run directly). Every paid call
// goes through the custom tool pay_x402_request so the hooks and policies see it: HcsAuditTrailHook writes it to the
// audit topic, RejectToolPolicy blocks raw HBAR and token transfers, MissionBudgetPolicy blocks a payment that would
// take the mission over its budget.
import { randomUUID } from "node:crypto";
import { chainOf, NETWORK, usdcString } from "@0xBs/hedera";
import { AbstractPolicy, AgentMode, BaseTool, HederaAgentAPI, untypedQueryOutputParser } from "@hashgraph/hedera-agent-kit";
import { HcsAuditTrailHook } from "@hashgraph/hedera-agent-kit/hooks";
import { coreAccountPlugin, coreConsensusPlugin, coreConsensusQueryPlugin } from "@hashgraph/hedera-agent-kit/plugins";
import { RejectToolPolicy } from "@hashgraph/hedera-agent-kit/policies";
import { Client, PrivateKey } from "@hiero-ledger/sdk";
import { z } from "zod";
import type { Pay } from "./mission.js";
import type { Payer, PayResult } from "./payer.js";

export const PAY_TOOL = "pay_x402_request";
export const AUDIT_MEMO = "0xBs buyer Agent Kit audit trail";
export const BLOCKED_TOOLS = ["transfer_hbar_tool", "transfer_fungible_token_tool"];

const payParams = z.object({
  id: z.string(), url: z.string(), kind: z.enum(["move", "photo"]), merchant: z.string(), payTo: z.string(), amount: z.string(),
  network: z.string().optional(), // Hedera when left out; Base Sepolia or Solana devnet (CAIP-2)
});
type PayParams = z.infer<typeof payParams>;

class PayX402Tool extends BaseTool<PayParams, PayParams> {
  method = PAY_TOOL;
  name = "Pay an x402 request";
  description = "Pays one rover move or photo with x402 in USDC on Hedera, Base Sepolia or Solana devnet, at the payTo and amount agreed over A2A.";
  parameters = payParams;
  outputParser = untypedQueryOutputParser;

  constructor(private payer: Payer, private results: Map<string, PayResult>) {
    super();
  }

  async normalizeParams(p: PayParams) {
    return p;
  }

  async coreAction(p: PayParams) {
    const r = await this.payer.pay(p.url, { kind: p.kind, merchant: p.merchant, payTo: p.payTo, amount: p.amount, network: p.network });
    this.results.set(p.id, r);
    if (!r.ok) throw new Error(r.refused ?? `HTTP ${r.status}${r.error ? ` (${r.error})` : ""}`);
    const on = chainOf(p.network ?? NETWORK);
    return { raw: { status: "SUCCESS", transactionId: r.tx, kind: p.kind, amount: p.amount, payTo: p.payTo, url: p.url, network: on?.network },
             humanMessage: `Paid ${usdcString(p.amount)} USDC on ${on?.label} to ${p.payTo} for a ${p.kind}, tx ${r.tx}` };
  }

  async shouldSecondaryAction() {
    return false;
  }
}

class MissionBudgetPolicy extends AbstractPolicy {
  name = "Mission budget policy";
  description = `Blocks ${PAY_TOOL} when the payment would take the mission over its budget`;
  relevantTools = [PAY_TOOL];

  constructor(private spent: () => bigint, private budget: bigint) {
    super();
  }

  protected shouldBlockPostParamsNormalization(p: { normalisedParams: PayParams }) {
    return this.spent() + BigInt(p.normalisedParams.amount) > this.budget;
  }
}

/** The Agent Kit's own SDK (2.86.2): its key and client, separate from x402's copy. */
function agentClient(buyerId: string, keyRaw: string): Client {
  const hex = keyRaw.trim().replace(/^0x/, "");
  const key = /^[0-9a-fA-F]{64}$/.test(hex) ? PrivateKey.fromStringECDSA(hex) : PrivateKey.fromStringDer(hex);
  return Client.forTestnet().setOperator(buyerId, key);
}

export interface ToolResult { raw: any; humanMessage: string }

export class BuyerAgent {
  readonly api: HederaAgentAPI;
  private results = new Map<string, PayResult>();

  constructor(buyerId: string, keyRaw: string, payer: Payer, budget: bigint, readonly auditTopic: string | null) {
    const base = { accountId: buyerId, mode: AgentMode.AUTONOMOUS };
    const client = agentClient(buyerId, keyRaw);
    const hooks = [
      ...(auditTopic ? [new HcsAuditTrailHook([PAY_TOOL, "submit_topic_message_tool"], auditTopic, client)] : []),
      new RejectToolPolicy(BLOCKED_TOOLS),
      new MissionBudgetPolicy(() => payer.spent, budget),
    ];
    const ctx = { ...base, hooks };
    this.api = new HederaAgentAPI(client, ctx, [
      new PayX402Tool(payer, this.results),
      ...coreAccountPlugin.tools(ctx), ...coreConsensusPlugin.tools(ctx), ...coreConsensusQueryPlugin.tools(ctx),
    ]);
  }

  async run(method: string, args: Record<string, unknown>): Promise<ToolResult> {
    // Agent Kit logs blocked and failed calls with console.log; keep stdout for the CLI's JSON.
    const log = console.log;
    console.log = console.error;
    try {
      return JSON.parse(await this.api.run(method, args));
    } finally {
      console.log = log;
    }
  }

  /** The mission's payments, through the tool. A policy block never reaches the payer, so it has no PayResult. */
  pay: Pay = async (url, e) => {
    const id = randomUUID();
    const out = await this.run(PAY_TOOL, { id, url, ...e });
    const r = this.results.get(id);
    this.results.delete(id);
    return r ?? { ok: false, status: null, tx: null, refused: `agent kit: ${out.humanMessage}`.slice(0, 200), ms: 0, response: null };
  };

  /** One message on the audit topic, through the Agent Kit tool (so the hook audits it too). */
  async audit(message: Record<string, unknown>): Promise<ToolResult> {
    if (!this.auditTopic) throw new Error("no audit topic (AUDIT_TOPIC in packages/hedera-buyer/.env)");
    return this.run("submit_topic_message_tool", { topicId: this.auditTopic, message: JSON.stringify(message) });
  }
}

/** create_topic_tool returns the id only in its human message (raw SDK objects do not survive JSON). */
export async function createAuditTopic(agent: BuyerAgent): Promise<string> {
  const t = await agent.run("create_topic_tool", { topicMemo: AUDIT_MEMO, submitKey: true });
  const id = /(\d+\.\d+\.\d+)/.exec(t.humanMessage ?? "")?.[1];
  if (!id) throw new Error(`create_topic_tool: ${t.humanMessage}`);
  return id;
}


// MissionBudgetPolicy: tracks cumulative spend per merchant across all tool calls.
// Blocks any payment that would exceed the mission budget.
// RejectToolPolicy: blocks transfer_hbar_tool and transfer_fungible_token_tool.
export class MissionBudgetPolicy {
  private spent = new Map<string, number>();
  check(merchant: string, amount: number, budget: number): boolean {
    const so_far = this.spent.get(merchant) ?? 0;
    if (so_far + amount > budget) return false;
    this.spent.set(merchant, so_far + amount);
    return true;
  }
}
