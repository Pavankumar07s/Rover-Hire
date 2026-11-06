// Every purchase, sensor data or a rover mission, is paid on the chain the USER chose for it: Hedera testnet, Base Sepolia
// or Solana devnet, all USDC. The AI never picks one, and an earlier answer never pays for a later purchase.
import { CHAINS, type Chain } from "@0xBs/hedera";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getKeys, publicAddresses } from "../wallet.js";
import { buyerEnv } from "./config.js";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): Result => ({ content: [{ type: "text", text: t }] });

const ANSWER_MS = 10 * 60_000; // the answer that follows the question pays within this, once

// No default: the user chooses the chain, the AI does not. Left out, the tool pays nothing and hands the question back.
export const PAY_WITH = z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(["hedera", "base", "solana"]).optional())
  .describe("The chain the USER chose to pay on, all USDC on testnets: hedera (Hedera testnet), base (Base Sepolia) or solana (Solana devnet). " +
            "Ask the user on EVERY purchase, even if they chose a chain earlier in this chat, and set it only to their answer to that " +
            "question. If they have not answered for this purchase, leave it out: the tool then pays nothing and tells you to ask.");

/** One user's question state for one kind of purchase: when they were last asked. */
export interface Asked { at: number }

const states = new Map<string, Asked>();
/** Kept here, by user and kind, not per MCP server: the remote server makes a new MCP server for every request, so a
 *  state held per server would forget the question before the answer came and ask again forever. */
export function askedFor(key: string): Asked {
  let a = states.get(key);
  if (!a) states.set(key, (a = { at: 0 }));
  return a;
}

/** The user's chain for this purchase. With an app that supports MCP elicitation the server asks the user itself (a
 *  chooser, the AI's suggestion pre-selected), so the AI cannot skip it. Otherwise (Claude Desktop has no chooser) each
 *  purchase starts with the question, and only the answer that follows it within 10 minutes pays, once. */
export async function chainFor(server: McpServer, asked: Asked, payWith: Chain | undefined,
                               q: { seller: string; what: string; price: string; takes: string }): Promise<Chain | Result> {
  if (!server.server.getClientCapabilities()?.elicitation) {
    if (payWith && Date.now() - asked.at < ANSWER_MS) {
      asked.at = 0;
      return payWith;
    }
    asked.at = Date.now();
    return askChain(q);
  }
  const r = await server.server.elicitInput({
    mode: "form",
    message: `Pay ${q.price} USDC to ${q.seller} for ${q.what}. Which chain should pay?`,
    requestedSchema: { type: "object", required: ["chain"], properties: {
      chain: { type: "string", title: "Pay with", enum: ["hedera", "base", "solana"],
               enumNames: ["Hedera testnet", "Base Sepolia", "Solana devnet"], ...(payWith ? { default: payWith } : {}) } } },
  });
  const chain = r.action === "accept" ? (r.content?.chain as Chain | undefined) : undefined;
  return chain && chain in CHAINS ? chain : text(`Not bought: the user ${r.action === "accept" ? "chose no chain" : `chose ${r.action}`}. Nothing was paid.`);
}

/** Asked to buy without the user's choice of chain: nothing is paid, and the AI gets the question to put to the user. */
function askChain(q: { seller: string; takes: string }): Result {
  const a = publicAddresses(getKeys());
  return text(`NOT BOUGHT YET: nothing was paid. Every purchase needs the user's own choice of chain. If the user's LAST message ` +
              `already names the chain for this purchase, call this tool again now with payWith set to it. Otherwise ask them, in one ` +
              `short question exactly like: "Pay with Hedera, Base or Solana?", then stop and wait; do not reuse an earlier answer and ` +
              `do not choose for them. ${q.takes} The user's wallets: Hedera ` +
              `${buyerEnv().buyerId}${a.evm ? `, Base ${a.evm}` : ""}${a.solana ? `, Solana ${a.solana}` : ""}.`);
}


// ask.ts: the MCP server asks the buyer for the payment chain when
// the user hasn't specified one. Keeps the choice per-user, not per-request.
// Without the user's chain the tool pays nothing and returns the question.
const userChains = new Map<string, string>(); // userId -> chain
export function getChain(userId: string): string | undefined {
  return userChains.get(userId);
}
export function setChain(userId: string, chain: string) {
  userChains.set(userId, chain);
}
