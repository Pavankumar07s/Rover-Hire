// Re-verifies an episode in the browser. 0G: each anchored segment's bytes from the indexer, their root recomputed
// locally, every record's hash, link, frame and TEE signature against the signer read live from 0G mainnet.
// Payments: each paid move on the chain that settled it (Hedera, Base Sepolia or Solana devnet), before the decision that used it.
import { chainPayment, type ChainPayment } from "@0xBs/hedera/browser";
import {
  auditSegment, downloadHttp, fileRoot, GENESIS, readTeeService,
  type DecisionRecord, type RecordAudit, type Segment, type SegmentAudit, type TeeService,
} from "@0xBs/zg/browser";
import type { Anchor, Episode } from "./episodes";
import { pool } from "./util";

export interface SegmentCheck extends Anchor {
  bytes: number | null;
  rootOk: boolean | null; // the downloaded bytes recompute to the anchored root
  eventOk: boolean | null; // the file's index and seq range are the ones the anchor event names
  audit: SegmentAudit | null;
  error: string | null;
}

export interface PaymentCheck {
  ledger: ChainPayment | null;
  paidBeforeUse: boolean;
  error: string | null;
}

export interface Checkpoint {
  record: DecisionRecord;
  audit: RecordAudit;
  segIndex: number;
  frame: string | null; // data URL of the frame 0G saw
  payment: PaymentCheck | null | undefined; // null: no paid move; undefined: not looked up yet
}

export interface Verification {
  tee: TeeService | null;
  teeError: string | null;
  segments: SegmentCheck[];
  checkpoints: Checkpoint[];
  endOk: boolean | null; // null until every segment is in, or when the episode has not ended
  done: boolean;
}

export async function verifyEpisode(ep: Episode, onUpdate: (v: Verification) => void, signal: AbortSignal): Promise<void> {
  const v: Verification = {
    tee: null, teeError: null, done: false, endOk: null, checkpoints: [],
    segments: ep.segments.map((a) => ({ ...a, bytes: null, rootOk: null, eventOk: null, audit: null, error: null })),
  };
  const push = () => { if (!signal.aborted) onUpdate({ ...v, segments: [...v.segments], checkpoints: [...v.checkpoints] }); };
  push();
  try {
    v.tee = await readTeeService();
  } catch (e) {
    v.teeError = (e as Error).message;
  }
  // Without the live signer every signature check would fail, so a failed read is reported, not faked.
  const tee = v.tee ?? { signerOnchain: "0x0000000000000000000000000000000000000000", acknowledged: false, verifiability: "", targetSeparated: null };
  push();

  let prevRoot: string | null = null;
  let prevHash = GENESIS;
  for (const [i, s] of v.segments.entries()) {
    if (signal.aborted) return;
    try {
      const bytes = await downloadHttp(s.root);
      const seg: Segment = JSON.parse(new TextDecoder().decode(bytes));
      const audit = auditSegment(seg, prevRoot, prevHash, tee);
      v.segments[i] = { ...s, bytes: bytes.length, rootOk: (await fileRoot(bytes)) === s.root,
                        eventOk: seg.segment_index === s.segIndex && seg.first_seq === s.firstSeq && seg.last_seq === s.lastSeq, audit };
      seg.records.forEach((record, k) => {
        const b64 = seg.images[record.img_sha256];
        v.checkpoints.push({ record, audit: audit.records[k]!, segIndex: s.segIndex, frame: b64 ? `data:image/jpeg;base64,${b64}` : null,
                             payment: record.money_tx ? undefined : null });
      });
      prevHash = seg.records.at(-1)?.hash ?? prevHash;
    } catch (e) {
      v.segments[i] = { ...s, error: (e as Error).message };
    }
    prevRoot = s.root;
    push();
  }

  if (ep.ended) {
    const recs = v.checkpoints.map((c) => c.record);
    v.endOk = v.segments.every((s) => s.error === null) && ep.ended.finalRoot === prevRoot
      && ep.ended.decisions === recs.filter((r) => r.decision).length && ep.ended.safeStops === recs.filter((r) => r.safe_stop).length;
  }
  push();

  await pool(v.checkpoints.map((c, i) => [c, i] as const).filter(([c]) => c.payment === undefined), 4, async ([c, i]) => {
    if (signal.aborted) return;
    let payment: PaymentCheck;
    try {
      const ledger = await chainPayment(c.record.money_tx as string);
      payment = { ledger, error: null, paidBeforeUse: !!ledger?.ok && ledger.at * 1000 < (c.record.t_reply_ms as number) };
    } catch (e) {
      payment = { ledger: null, paidBeforeUse: false, error: (e as Error).message };
    }
    v.checkpoints[i] = { ...c, payment };
    push();
  });
  v.done = true;
  push();
}

/** The tamper test, for anyone: check a segment file from disk against the episode's anchors. */
export async function checkFile(bytes: Uint8Array, ep: Episode, tee: TeeService, prevHashOf: (segIndex: number) => string):
  Promise<{ root: string; anchor: Anchor | null; rootOk: boolean; audit: SegmentAudit | null; error: string | null }> {
  const root = await fileRoot(bytes);
  let seg: Segment;
  try {
    seg = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { root, anchor: null, rootOk: false, audit: null, error: "not a segment file (JSON does not parse)" };
  }
  const anchor = ep.segments.find((a) => a.segIndex === seg.segment_index) ?? null;
  if (!anchor) return { root, anchor, rootOk: false, audit: null, error: `episode ${ep.id} has no segment ${seg.segment_index}` };
  const prevRoot = ep.segments.find((a) => a.segIndex === seg.segment_index - 1)?.root ?? null;
  return { root, anchor, rootOk: root === anchor.root, audit: auditSegment(seg, prevRoot, prevHashOf(seg.segment_index), tee), error: null };
}
// 2026-11-06T20:26:00
// 2026-11-06T22:44:19


// Tamper test: iterate over all records, flag only the one whose hash
// doesn't match, pass the others. Don't short-circuit on first failure.
export function verifySegment(seg: Segment): VerifyResult[] {
  return seg.records.map(r => {
    const { hash, ...rest } = r;
    const computed = recordHash(rest);
    return { seq: r.seq, ok: computed === hash, computed, stored: hash };
  });
}
