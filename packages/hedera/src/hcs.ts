// Hash-chained JSON log on an HCS topic (plan §3.5): each message carries seq and prev = sha256 of the
// previous message string. Messages over 1 KB are refused before they reach the network.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { TopicMessageSubmitTransaction, type Client } from "@hiero-ledger/sdk";
import { topicMessages } from "./mirror.js";

export const HCS_MAX_BYTES = 1024;
export const GENESIS = "0".repeat(64);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class HcsLog {
  private constructor(private client: Client, readonly topicId: string, public seq: number, public prev: string) {}

  /** Continues an existing topic's chain from its last message on the mirror node. */
  static async open(client: Client, topicId: string): Promise<HcsLog> {
    const [last] = await topicMessages(topicId, 1, "desc");
    if (!last) return new HcsLog(client, topicId, 0, GENESIS);
    const j = JSON.parse(last.text);
    if (typeof j.seq !== "number") throw new Error(`topic ${topicId}: last message is not part of a hash chain`);
    return new HcsLog(client, topicId, j.seq + 1, sha256(last.text));
  }

  async log(entry: Record<string, unknown>): Promise<{ seq: number; message: string; txId: string }> {
    const message = JSON.stringify({ v: 1, seq: this.seq, prev: this.prev, ...entry });
    const bytes = Buffer.byteLength(message, "utf8");
    if (bytes > HCS_MAX_BYTES) throw new Error(`HCS message is ${bytes} bytes (max ${HCS_MAX_BYTES})`);
    const resp = await new TopicMessageSubmitTransaction().setTopicId(this.topicId).setMessage(message).execute(this.client);
    await resp.getReceipt(this.client);
    const seq = this.seq;
    this.seq += 1;
    this.prev = sha256(message);
    return { seq, message, txId: resp.transactionId.toString() };
  }
}

/** Entries go to disk first, then to the topic in order; a restart resumes the unsent ones. An entry whose submit
 *  succeeded just before a crash is sent again (a duplicate with the next seq; the chain stays valid). */
export class HcsSpool {
  private running = false;
  private done: string;

  constructor(private log: HcsLog, private file: string) {
    this.done = `${file}.done`;
  }

  enqueue(entry: Record<string, unknown>): void {
    appendFileSync(this.file, JSON.stringify(entry) + "\n");
    void this.drain();
  }

  pending(): number {
    const lines = existsSync(this.file) ? readFileSync(this.file, "utf8").split("\n").filter(Boolean) : [];
    return lines.length - (existsSync(this.done) ? Number(readFileSync(this.done, "utf8")) : 0);
  }

  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (existsSync(this.file)) {
        const lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean);
        let done = existsSync(this.done) ? Number(readFileSync(this.done, "utf8")) : 0;
        if (done >= lines.length) {
          unlinkSync(this.file);
          if (existsSync(this.done)) unlinkSync(this.done);
          break;
        }
        await this.log.log(JSON.parse(lines[done]!));
        writeFileSync(this.done, String(++done));
      }
    } catch (e) {
      console.error(`HCS spool: ${(e as Error).message}; retrying in 5 s`);
      setTimeout(() => void this.drain(), 5000);
    } finally {
      this.running = false;
    }
  }
}

/** Checks seq and prev links of a topic's messages (as read from the mirror node). */
export function verifyHcsChain(texts: string[]): { ok: boolean; error?: string } {
  let prev = GENESIS;
  for (let i = 0; i < texts.length; i++) {
    const j = JSON.parse(texts[i]!);
    if (j.seq !== i) return { ok: false, error: `message ${i}: seq ${j.seq}` };
    if (j.prev !== prev) return { ok: false, error: `message ${i}: prev link broken` };
    prev = sha256(texts[i]!);
  }
  return { ok: true };
}
// 2026-11-06T11:32:00
// 2026-11-06T22:31:18
