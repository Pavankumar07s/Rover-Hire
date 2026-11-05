// Per-record verdicts (replay page, tamper test): unlike verifySegment, nothing stops at the first fault, so one
// edited record fails alone while the others still verify.
import { sha256Hex } from "./canonical.js";
import { recordHash, type DecisionRecord, type Segment } from "./records.js";
import { verifyTeeSignature, type TeeService } from "./tee.js";

export interface RecordAudit {
  seq: number;
  hash: boolean; // the record recomputes to its own hash
  link: boolean; // right seq, and prev_hash is the stored hash of the record before it
  image: boolean; // its frame is in the segment and matches img_sha256
  signature: { verified: boolean; signer: string | null; reason?: string } | null; // null: 0G sent no signature (safe stop)
  claim: boolean; // the rover's own proof.verified says the same as this re-check
  numberCheck: { verified: boolean; signer: string | null; reason?: string } | null; // the photo check's own signature
  ok: boolean;
}

export interface SegmentAudit {
  index: number;
  header: string | null; // why the segment itself does not fit, or null
  records: RecordAudit[];
  ok: boolean;
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function auditSegment(seg: Segment, prevSegmentRoot: string | null, prevHash: string, tee: TeeService): SegmentAudit {
  const recs: DecisionRecord[] = seg.records ?? [];
  let header: string | null = null;
  if (seg.v !== 1) header = "unknown segment version";
  else if (seg.prev_segment_root !== prevSegmentRoot) header = "prev_segment_root does not link to the segment before";
  else if (!recs.length || recs[0]!.seq !== seg.first_seq || recs.at(-1)!.seq !== seg.last_seq) header = "first_seq/last_seq do not match its records";
  else if (recs.some((r) => r.episode_id !== seg.episode_id)) header = "holds a record of another episode";
  const images = new Map<string, boolean>();
  const imageOk = (sha: string): boolean => {
    if (!images.has(sha)) {
      const b64 = seg.images?.[sha];
      let ok = false;
      try { ok = typeof b64 === "string" && sha256Hex(base64ToBytes(b64)) === sha; } catch { ok = false; }
      images.set(sha, ok);
    }
    return images.get(sha)!;
  };
  const records = recs.map((r, i): RecordAudit => {
    let hash = false;
    try { hash = recordHash(r) === r.hash; } catch { hash = false; }
    const link = r.seq === seg.first_seq + i && r.prev_hash === (i === 0 ? prevHash : recs[i - 1]!.hash);
    const image = imageOk(r.img_sha256);
    const p = r.proof;
    const signature = p?.signed_text && p.signature ? verifyTeeSignature(p.signed_text, p.signature, tee) : null;
    const claim = (signature?.verified ?? false) === !!p?.verified;
    const nc = r.number_check?.proof;
    const numberCheck = nc?.signed_text && nc.signature ? verifyTeeSignature(nc.signed_text, nc.signature, tee) : null;
    const ncClaim = (numberCheck?.verified ?? false) === !!nc?.verified;
    return { seq: r.seq, hash, link, image, signature, claim, numberCheck, ok: hash && link && image && claim && ncClaim };
  });
  return { index: seg.segment_index, header, records, ok: !header && records.every((r) => r.ok) };
}
