import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";
import { canonical, EPISODE_LOG_ABI, GENESIS, recordHash, segmentBytes, storageRoot, verifyChain, verifySegment,
         verifyTeeSignature, type Segment } from "../dist/index.js";
import { abiJson, episodes, frame, records } from "./p3.ts";

test("every P3 record hashes the same in TypeScript as in Python", () => {
  assert.equal(records.length, 108);
  for (const r of records) assert.equal(recordHash(r), r.hash, `${r.episode_id} seq ${r.seq}`);
});

test("every P3 episode chain verifies", () => {
  for (const e of episodes()) verifyChain(e);
});

test("canonical JSON matches Python's sort_keys/compact/ensure_ascii=False", () => {
  assert.equal(canonical({ b: 1, a: ["é", null, true, "line\nbreak \u001f"] }), '{"a":["é",null,true,"line\\nbreak \\u001f"],"b":1}');
  assert.throws(() => canonical({ latency_ms: 2486.5 }), /integers only/);
});

test("all P3 TEE signatures re-verify offline against the recorded on-chain signer", () => {
  let checked = 0;
  for (const r of records) {
    const p = r.proof as typeof r.proof & { acknowledged: boolean; verifiability: string; target_separated: boolean };
    if (!p.signed_text || !p.signature || !p.signer_onchain) continue;
    const service = { signerOnchain: p.signer_onchain, acknowledged: p.acknowledged, verifiability: p.verifiability,
                      targetSeparated: p.target_separated };
    assert.equal(verifyTeeSignature(p.signed_text, p.signature, service).verified, p.verified, `${r.episode_id} seq ${r.seq}`);
    checked++;
  }
  assert.ok(checked >= 90, `only ${checked} signatures`);
});

function realSegment(): Segment {
  const ep = episodes().find((e) => e.length >= 10 && e.every((r) => frame(r.img_sha256)))!;
  const recs = ep.slice(0, 10);
  const images = Object.fromEntries(recs.map((r) => [r.img_sha256, frame(r.img_sha256)!.toString("base64")]));
  return { v: 1, episode_id: recs[0]!.episode_id, segment_index: 0, prev_segment_root: null, first_seq: 0, last_seq: 9, records: recs, images };
}

test("a segment of real records and frames verifies; tampering is caught", async () => {
  const seg = realSegment();
  verifySegment(seg, null, GENESIS);
  assert.match(await storageRoot(segmentBytes(seg)), /^0x[0-9a-f]{64}$/);
  const sha = Object.keys(seg.images)[0]!;
  const badImage = { ...seg, images: { ...seg.images, [sha]: Buffer.from("not the frame").toString("base64") } };
  assert.throws(() => verifySegment(badImage, null, GENESIS), /does not match its hash/);
  assert.throws(() => verifySegment(seg, "0x" + "11".repeat(32), GENESIS), /prev_segment_root/);
  const edited = structuredClone(seg);
  edited.records[4]!.decision!.skill = "approach";
  assert.throws(() => verifySegment(edited, null, GENESIS), /hash mismatch/);
});

test("the client ABI matches the compiled EpisodeLog", () => {
  const ours = new Interface(EPISODE_LOG_ABI);
  const compiled = new Interface(abiJson);
  const sigs = (i: Interface) => {
    const out: string[] = [];
    i.forEachFunction((f) => out.push(f.format("sighash")));
    i.forEachEvent((e) => out.push(e.format("sighash")));
    i.forEachError((e) => out.push(e.format("sighash")));
    return out.sort();
  };
  assert.deepEqual(sigs(ours), sigs(compiled));
});
