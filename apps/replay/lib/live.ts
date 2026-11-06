// A running mission from public data only. Hedera: the rover's money topic and the haggling audit on the mirror node,
// seconds behind. 0G: the EpisodeLog's events on Galileo, and each new batch from 0G Storage re-checked here, a minute
// or two behind (a batch is stored every minute, then anchored).
import { chainOfTx, HASHSCAN, mirror, txIdToMirror, usdcString } from "@0xBs/hedera/browser";
import { auditSegment, downloadHttp, EPISODE_LOG_ABI, fileRoot, type DecisionRecord, type RecordAudit, type Segment, type TeeService } from "@0xBs/zg/browser";
import { Contract, type EventLog } from "ethers";
import { DEFAULT_LOG, DEFAULT_ROVER, TOPICS } from "./config";
import { galileo, type Anchor } from "./episodes";

/** New EpisodeLog events since a block: a new or ended mission means the episode list is read again. */
export async function chainSince(fromBlock: number) {
  const provider = galileo();
  const to = await provider.getBlockNumber();
  if (to < fromBlock) return { to: fromBlock - 1, changed: false, anchored: [] as (Anchor & { key: string })[] };
  const c = new Contract(DEFAULT_LOG, EPISODE_LOG_ABI, provider);
  const f = c.filters;
  const [started, anchored, ended] = (await Promise.all([
    c.queryFilter(f.EpisodeStarted!(null, DEFAULT_ROVER), fromBlock, to),
    c.queryFilter(f.SegmentAnchored!(), fromBlock, to),
    c.queryFilter(f.EpisodeEnded!(), fromBlock, to),
  ])) as EventLog[][];
  return {
    to, changed: started!.length > 0 || ended!.length > 0,
    anchored: anchored!.map((a) => ({ key: a.args.episodeId as string, segIndex: Number(a.args.segIndex), root: a.args.root as string,
                                      firstSeq: Number(a.args.firstSeq), lastSeq: Number(a.args.lastSeq), tx: a.transactionHash, block: a.blockNumber })),
  };
}

export interface LiveStep {
  record: DecisionRecord;
  audit: RecordAudit;
  frame: string | null; // data URL of the frame 0G saw
}

export interface LiveSegment {
  anchor: Anchor;
  rootOk: boolean;
  ok: boolean; // root, hashes, links, frames and TEE signatures all re-check
  steps: LiveStep[];
  lastHash: string;
}

/** One anchored batch from 0G Storage, re-checked against its anchor and the batch before it. */
export async function loadSegment(a: Anchor, prevRoot: string | null, prevHash: string, tee: TeeService): Promise<LiveSegment> {
  const bytes = await downloadHttp(a.root);
  const seg: Segment = JSON.parse(new TextDecoder().decode(bytes));
  const audit = auditSegment(seg, prevRoot, prevHash, tee);
  const rootOk = (await fileRoot(bytes)) === a.root;
  const steps = seg.records.map((record, k) => {
    const b64 = seg.images[record.img_sha256];
    return { record, audit: audit.records[k]!, frame: b64 ? `data:image/jpeg;base64,${b64}` : null };
  });
  return { anchor: a, rootOk, ok: rootOk && audit.ok, steps, lastHash: seg.records.at(-1)?.hash ?? prevHash };
}

export interface FeedItem {
  kind: "deal" | "start" | "move" | "photo" | "end";
  ts: string; // consensus timestamp of the topic message
  text: string;
  usdc: number; // paid in this item
  tx: string | null; // the payment, for its HashScan link
  photo: number | null;
}

type Message = { consensus_timestamp: string; message: string };

async function messages(topic: string, after: string): Promise<Message[]> {
  const out: Message[] = [];
  let path: string | null = `/api/v1/topics/${topic}/messages?order=asc&limit=100&timestamp=gt:${after}`;
  while (path) {
    const d: { messages?: Message[]; links?: { next: string | null } } | null = await mirror(path);
    out.push(...(d?.messages ?? []));
    path = d?.links?.next ?? null;
  }
  return out;
}

const decode = (m: Message) => {
  const text = atob(m.message);
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
};

/** The mission's Hedera messages after a timestamp, in plain words; returns the new cursor for the next read. */
export async function feedSince(quote: string, after: string): Promise<{ items: FeedItem[]; cursor: string }> {
  const [shop, audit] = await Promise.all([messages(TOPICS.money, after), messages(TOPICS.audit, after)]);
  const items: FeedItem[] = [];
  for (const m of shop) {
    const { json: j } = decode(m);
    if (j?.quote_id !== quote) continue;
    const usdc = j.amount ? Number(usdcString(j.amount)) : 0;
    if (j.type === "quote") items.push({ kind: "start", ts: m.consensus_timestamp, usdc: 0, tx: null, photo: null,
      text: `Mission started: ${usdcString(j.amount)} USDC a move, ${usdcString(j.photo_price)} a photo` });
    else if (j.type === "move") items.push({ kind: "move", ts: m.consensus_timestamp, usdc, tx: j.tx, photo: null, text: `Move paid, ${usdcString(j.amount)} USDC` });
    else if (j.type === "photo") items.push({ kind: "photo", ts: m.consensus_timestamp, usdc, tx: j.tx, photo: j.photo, text: `Photo ${j.photo} paid, ${usdcString(j.amount)} USDC` });
    else if (j.type === "end") items.push({ kind: "end", ts: m.consensus_timestamp, usdc: 0, tx: null, photo: null,
      text: `Mission closed: ${j.moves_paid} moves and ${j.photos_paid} photos paid` });
  }
  for (const m of audit) {
    const { json: j } = decode(m);
    if (j?.type === "negotiation" && j.quote_id === quote) items.push({ kind: "deal", ts: m.consensus_timestamp, usdc: 0, tx: null, photo: null,
      text: `Haggled with ${j.offers?.length ?? 0} rovers, chose agent #${j.chosen}` });
  }
  const last = [...shop, ...audit].map((m) => m.consensus_timestamp).sort().at(-1);
  return { items: items.sort((a, b) => a.ts.localeCompare(b.ts)), cursor: last ?? after }; // two topics, one timeline
}

const consensus = new Map<string, string>();

/** A payment on its chain's explorer. HashScan opens a Hedera transaction by its consensus timestamp, which the mirror
 *  node gives for a transaction id; a Base or Solana payment links straight to its explorer. */
export async function paymentLink(tx: string): Promise<string> {
  const c = chainOfTx(tx);
  if (c && c.chain !== "hedera") return c.txUrl(tx);
  if (!consensus.has(tx)) {
    const d = await mirror(`/api/v1/transactions/${txIdToMirror(tx)}`).catch(() => null);
    const ts = d?.transactions?.[0]?.consensus_timestamp;
    if (ts) consensus.set(tx, ts);
  }
  const ts = consensus.get(tx);
  return ts ? `${HASHSCAN}/transaction/${ts}` : `${HASHSCAN}/search-result?q=${encodeURIComponent(tx)}`;
}
