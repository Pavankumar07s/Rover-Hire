// Verifies an episode from the chain and 0G Storage alone (the replay page's path), not from zg-log's files:
// EpisodeLog events → each segment over HTTPS /file?root= → chain, links, image hashes, TEE signatures, end counts.
// Usage: node scripts/verify-episode.ts <episode_id> [fromBlock]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  downloadHttp, EpisodeLog, GALILEO, GENESIS, readTeeService, verifySegment, verifyTeeSignature, type DecisionRecord, type Segment,
} from "@0xBs/zg";
import { JsonRpcProvider } from "ethers";

// The live EpisodeLog, as contracts/episode-log/deploy.ts recorded it.
const deployment = JSON.parse(readFileSync(new URL("../../../contracts/episode-log/deployment.json", import.meta.url), "utf8"));
const CONTRACT: string = deployment.address;
const DEPLOY_BLOCK: number = deployment.block;
const [episodeId, fromArg] = process.argv.slice(2);
if (!episodeId) throw new Error("usage: verify-episode.ts <episode_id> [fromBlock]");

const log = new EpisodeLog(CONTRACT, new JsonRpcProvider(GALILEO.rpc, GALILEO.chainId, { staticNetwork: true }));
const events = await log.events(episodeId, Number(fromArg ?? DEPLOY_BLOCK));
const tee = await readTeeService();
const checks: Record<string, boolean> = {};
const segments: object[] = [];
const records: DecisionRecord[] = [];
let prevRoot: string | null = null;
let prevHash = GENESIS;

for (const ev of events.segments) {
  const t0 = performance.now();
  const bytes = await downloadHttp(ev.root);
  const seconds = Math.round(performance.now() - t0) / 1000;
  const seg: Segment = JSON.parse(new TextDecoder().decode(bytes));
  let ok = true;
  let error: string | null = null;
  try {
    if (seg.segment_index !== ev.segIndex || seg.first_seq !== ev.firstSeq || seg.last_seq !== ev.lastSeq) throw new Error("event does not match segment");
    verifySegment(seg, prevRoot, prevHash);
  } catch (e) {
    ok = false;
    error = (e as Error).message;
  }
  const sigs = seg.records.filter((r) => r.proof.signed_text && r.proof.signature)
    .map((r) => verifyTeeSignature(r.proof.signed_text!, r.proof.signature!, tee).verified === r.proof.verified);
  segments.push({ index: ev.segIndex, root: ev.root, tx: ev.tx, first_seq: ev.firstSeq, last_seq: ev.lastSeq, bytes: bytes.length,
                  images: Object.keys(seg.images).length, download_s: seconds, verified: ok, error, signatures_agree: sigs.every(Boolean), signatures: sigs.length });
  records.push(...seg.records);
  prevRoot = ev.root;
  prevHash = seg.records.at(-1)?.hash ?? prevHash;
}

checks.started = !!events.started;
checks.segments_verify = segments.length > 0 && segments.every((s) => (s as { verified: boolean }).verified);
checks.signatures_agree = segments.every((s) => (s as { signatures_agree: boolean }).signatures_agree);
checks.contiguous_seq = records.every((r, i) => r.seq === i);
checks.ended = !!events.ended && events.ended.finalRoot === prevRoot
  && events.ended.decisions === records.filter((r) => r.decision).length
  && events.ended.safeStops === records.filter((r) => r.safe_stop).length;
const result = {
  at: new Date().toISOString(), episode_id: episodeId, contract: CONTRACT, started: events.started, ended: events.ended,
  tee_signer_onchain: tee.signerOnchain, records: records.length, segments, checks, pass: Object.values(checks).every(Boolean),
};
const dir = new URL("../../../docs/rover/evidence/P4/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL(`verify_${episodeId}.json`, dir), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ episode_id: episodeId, records: records.length, segments: segments.length, checks, pass: result.pass }));
// 2026-11-06T10:12:00
