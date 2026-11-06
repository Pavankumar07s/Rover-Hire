// ERC-8004 feedback after a mission (plan Phase 7 task 5): score = round(100 x paid photos / wanted photos), tag1
// "starred", tag2 "inspection", the seller's endpoint, and a feedback file whose keccak256 goes on chain; its
// proofOfPayment is the last photo payment. A Hashio write takes 8-12 s, so it runs after /end, never in the loop.
import { cardUri, NETWORK, reputation, send, view, type Sent } from "@0xBs/hedera";
import { ethers } from "ethers";

const TRIES = 3;

export interface Feedback {
  tx: string | null; // null when the relay failed but the feedback is on chain anyway
  feeHbar: number;
  score: number;
  feedbackURI: string;
  feedbackHash: string;
  file: Record<string, unknown>;
  readBack: { index: string; value: number; tag1: string; tag2: string; revoked: boolean };
  summary: { count: number; value: number };
}

export async function giveFeedback(wallet: ethers.Wallet, o: { agentId: string; endpoint: string; quoteId: string; photosWanted: number;
                                                               photosPaid: number; payTo: string; proofTx: string; proofAmount: string;
                                                               proofNetwork?: string }): Promise<Feedback> {
  const score = Math.round((100 * o.photosPaid) / o.photosWanted);
  const file = { agentId: Number(o.agentId), quote_id: o.quoteId, task: "parcel-inspection", photos_wanted: o.photosWanted, photos_paid: o.photosPaid,
                 score, proofOfPayment: { network: o.proofNetwork ?? NETWORK, txId: o.proofTx, payTo: o.payTo, amount: o.proofAmount }, at: new Date().toISOString() };
  const bytes = ethers.toUtf8Bytes(JSON.stringify(file));
  const feedbackURI = cardUri(file);
  const feedbackHash = ethers.keccak256(bytes);
  const rep = reputation(wallet);
  const lastIndex = async (): Promise<bigint> => (await view("reputation", "getLastIndex", [o.agentId, wallet.address]))[0];
  const before = await lastIndex();
  let sent: Sent | null = null;
  for (let i = 1; !sent; i++) {
    try {
      sent = await send(rep, "giveFeedback", [o.agentId, score, 0, "starred", "inspection", o.endpoint, feedbackURI, feedbackHash]);
    } catch (e) {
      // Hashio can answer 500 for a write that still landed: count this client's feedback before sending it again.
      await new Promise((r) => setTimeout(r, 3000 * i));
      if ((await lastIndex()) > before) break;
      if (i >= TRIES) throw e;
    }
  }
  const index = await lastIndex();
  const [value, decimals, tag1, tag2, revoked] = await view("reputation", "readFeedback", [o.agentId, wallet.address, index]);
  // Over all the agent's clients, as discovery reads it, so "rating now" matches the rating it was hired at.
  const clients: string[] = [...(await view("reputation", "getClients", [o.agentId]))[0]];
  const [count, sum, sumDecimals] = await view("reputation", "getSummary", [o.agentId, clients, "starred", ""]);
  return { tx: sent?.hash ?? null, feeHbar: sent?.feeHbar ?? 0, score, feedbackURI, feedbackHash, file,
           readBack: { index: index.toString(), value: Number(value) / 10 ** Number(decimals), tag1, tag2, revoked },
           summary: { count: Number(count), value: Number(sum) / 10 ** Number(sumDecimals) } };
}
