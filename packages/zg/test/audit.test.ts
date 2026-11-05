import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { auditSegment, recordHash, type Segment } from "../dist/index.js";
import { fileRoot } from "../dist/browser.js";

// Segment 1 of a real episode from before the event, exactly as downloaded from 0G Storage, and its
// root as anchored on Galileo. The bytes can't change, so the file still names that run's id inside.
const BYTES = readFileSync(new URL("./fixtures/segment_29oct_1.json", import.meta.url));
const ROOT = "0xd64075605a5ac0893fb5523819da43c31ce5ba6b9556d4b897b7b2ce68f770fa";
const PREV_ROOT = "0xbe661b782e2a467dc23c486978cc5ce8f31a399a1011435dbb83c0bce8f8472f";
const parse = (b: Uint8Array): Segment => JSON.parse(new TextDecoder().decode(b));
const seg = parse(BYTES);
const p = seg.records.find((r) => r.proof.signer_onchain)!.proof;
const tee = { signerOnchain: p.signer_onchain!, acknowledged: true, verifiability: "TeeML", targetSeparated: false };
const prevHash = seg.records[0]!.prev_hash;

/** The file with one byte changed at the first occurrence of `marker` (after `from`). */
function flip(marker: string, from = 0): Uint8Array {
  const out = Uint8Array.from(BYTES);
  const at = BYTES.indexOf(marker, from) + marker.length;
  out[at] = out[at] === 0x41 ? 0x42 : 0x41;
  return out;
}

test("the real segment verifies record by record, and its root recomputes to the anchored one", async () => {
  const a = auditSegment(seg, PREV_ROOT, prevHash, tee);
  assert.equal(a.header, null);
  assert.equal(a.records.length, 4);
  assert.ok(a.ok, JSON.stringify(a.records));
  assert.equal(await fileRoot(BYTES), ROOT);
});

test("one byte changed in a record's text: that record fails, the others pass, the root no longer matches", async () => {
  // Keys are sorted, so the third record's "decision" sits between the second record's "hash" and its own.
  const bytes = flip(`"see":"`, BYTES.indexOf(`"hash":"${seg.records[1]!.hash}"`));
  const a = auditSegment(parse(bytes), PREV_ROOT, prevHash, tee);
  assert.deepEqual(a.records.map((r) => r.ok), [true, true, false, true]);
  assert.equal(a.records[2]!.hash, false);
  assert.notEqual(await fileRoot(bytes), ROOT);
});

test("one byte changed in a frame: the record that used it fails, the others pass", () => {
  const second = seg.records[1]!;
  const bytes = flip(`"${second.img_sha256}":"/9j/4AAQ`);
  const a = auditSegment(parse(bytes), PREV_ROOT, prevHash, tee);
  assert.deepEqual(a.records.map((r) => r.image), seg.records.map((r) => r.img_sha256 !== second.img_sha256));
  assert.equal(a.records[1]!.ok, false);
});

test("a photo's number check is verified like a decision: a broken signature fails that record", () => {
  const rec = structuredClone(seg.records[0]!);
  rec.number_check = { number: "3", ok: true, proof: structuredClone(rec.proof) };  // a real signature from this episode
  rec.hash = recordHash(rec);
  const one = { ...seg, first_seq: rec.seq, last_seq: rec.seq, records: [rec] };
  const good = auditSegment(one, PREV_ROOT, prevHash, tee).records[0]!;
  assert.equal(good.numberCheck?.verified, true);
  assert.equal(good.ok, true);
  rec.number_check.proof.signature = rec.number_check.proof.signature!.slice(0, -4) + "0000";
  rec.hash = recordHash(rec);
  const bad = auditSegment(one, PREV_ROOT, prevHash, tee).records[0]!;
  assert.equal(bad.numberCheck?.verified, false);
  assert.equal(bad.ok, false);
});

test("a wrong TEE signer fails every signed record", () => {
  const a = auditSegment(seg, PREV_ROOT, prevHash, { ...tee, signerOnchain: "0x" + "11".repeat(20) });
  for (const [i, r] of seg.records.entries()) assert.equal(a.records[i]!.ok, !r.proof.signature);
});
