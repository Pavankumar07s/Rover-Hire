// Browser entry (apps/replay): everything but the Node storage SDK. File roots come from the SDK's own browser build.
export { auditSegment, type RecordAudit, type SegmentAudit } from "./audit.js";
export { canonical, sha256Hex } from "./canonical.js";
export { GALILEO, GENESIS, MAINNET, SIG_PREFIX } from "./constants.js";
export { EPISODE_LOG_ABI, EpisodeLog, episodeKey, type EpisodeEvents } from "./episode-log.js";
export { downloadHttp } from "./http.js";
export { recordHash, verifyChain, verifySegment, type DecisionRecord, type Segment } from "./records.js";
export { readTeeService, verifyTeeSignature, type TeeService } from "./tee.js";

/** The 0G Storage root of a file, computed locally: equal to the anchored root only if these are the anchored bytes. */
export async function fileRoot(bytes: Uint8Array): Promise<string> {
  const { MemData } = await import("@0gfoundation/0g-storage-ts-sdk/browser");
  const [tree, err] = await new MemData(bytes).merkleTree();
  if (err || !tree) throw err ?? new Error("merkle tree failed");
  return tree.rootHash() as string;
}
