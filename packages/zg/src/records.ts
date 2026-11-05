// Decision records and 60 s segments (plan §3.3): hash chain, segment links, image hashes.
import { canonical, sha256Hex } from "./canonical.js";
import { GENESIS } from "./constants.js";

export interface DecisionRecord {
  v: 1;
  episode_id: string;
  seq: number;
  prev_hash: string;
  img_sha256: string;
  decision: { see: string; skill: string; target: number[] | null; stop_cm: number | null; reason: string } | null;
  proof: { signed_text: string | null; signature: string | null; signer: string | null; signer_onchain: string | null; verified: boolean };
  safe_stop: { reason: string; detail?: string } | null;
  // Before a photo is paid, 0G's blind reading of the number on a crop of the box, with its own TEE proof (prompt v6).
  number_check?: { number: string | null; ok: boolean; proof: DecisionRecord["proof"] };
  hash: string;
  [field: string]: unknown;
}

export interface Segment {
  v: 1;
  episode_id: string;
  segment_index: number;
  prev_segment_root: string | null;
  first_seq: number;
  last_seq: number;
  records: DecisionRecord[];
  images: Record<string, string>; // img_sha256 → base64 JPEG
}

export function recordHash(record: Record<string, unknown>): string {
  const { hash: _, ...rest } = record;
  return sha256Hex(canonical(rest));
}

/** Throws at the first record whose sequence, link or hash is wrong. `prevHash` links to the record before the first one. */
export function verifyChain(records: DecisionRecord[], prevHash = GENESIS, firstSeq = 0): void {
  let prev = prevHash;
  records.forEach((r, i) => {
    if (r.seq !== firstSeq + i) throw new Error(`record ${r.seq}: expected seq ${firstSeq + i}`);
    if (r.prev_hash !== prev) throw new Error(`record ${r.seq}: broken link`);
    if (recordHash(r) !== r.hash) throw new Error(`record ${r.seq}: hash mismatch`);
    prev = r.hash;
  });
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Verifies one segment against what came before it: previous segment root and last record hash. */
export function verifySegment(segment: Segment, prevSegmentRoot: string | null, prevHash: string): void {
  if (segment.v !== 1) throw new Error("unknown segment version");
  if (segment.prev_segment_root !== prevSegmentRoot) throw new Error(`segment ${segment.segment_index}: prev_segment_root mismatch`);
  const { records } = segment;
  if (!records.length) throw new Error(`segment ${segment.segment_index}: empty`);
  if (records[0]!.seq !== segment.first_seq || records[records.length - 1]!.seq !== segment.last_seq) {
    throw new Error(`segment ${segment.segment_index}: first_seq/last_seq do not match its records`);
  }
  if (records.some((r) => r.episode_id !== segment.episode_id)) throw new Error(`segment ${segment.segment_index}: foreign record`);
  verifyChain(records, prevHash, segment.first_seq);
  for (const [sha, b64] of Object.entries(segment.images)) {
    if (sha256Hex(base64ToBytes(b64)) !== sha) throw new Error(`segment ${segment.segment_index}: image ${sha} does not match its hash`);
  }
  for (const r of records) {
    if (!(r.img_sha256 in segment.images)) throw new Error(`record ${r.seq}: image ${r.img_sha256} missing from its segment`);
  }
}

export function segmentBytes(segment: Segment): Uint8Array {
  return new TextEncoder().encode(canonical(segment));
}
