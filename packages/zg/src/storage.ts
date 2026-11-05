// 0G Storage on Galileo, using the calls proven in the bench (HANDOFF §7): MemData → merkleTree → Indexer.upload.
import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import type { Signer } from "ethers";
import { GALILEO } from "./constants.js";

export interface Upload {
  root: string;
  txHash: string;
  bytes: number;
  seconds: number;
}

export async function storageRoot(bytes: Uint8Array): Promise<string> {
  const [tree, err] = await new MemData(bytes).merkleTree();
  if (err || !tree) throw err ?? new Error("merkle tree failed");
  return tree.rootHash() as string;
}

/** Waits for finality (~17 s on the bench), so callers run it in a background queue. */
export async function upload(bytes: Uint8Array, signer: Signer, indexer: string = GALILEO.indexer, rpc: string = GALILEO.rpc): Promise<Upload> {
  const file = new MemData(bytes);
  const [tree, treeErr] = await file.merkleTree();
  if (treeErr || !tree) throw treeErr ?? new Error("merkle tree failed");
  const t0 = performance.now();
  // The SDK's signer type comes from its own ethers 6.13.1 typings, the same version as ours.
  const [tx, err] = await new Indexer(indexer).upload(file, rpc, signer as never);
  if (err) throw err;
  const result = tx as { txHash?: string; rootHash?: string; txHashes?: string[]; rootHashes?: string[] };
  return {
    root: result.rootHash ?? result.rootHashes?.[0] ?? (tree.rootHash() as string),
    txHash: result.txHash ?? result.txHashes?.[0] ?? "",
    bytes: bytes.length,
    seconds: Math.round(performance.now() - t0) / 1000,
  };
}

/** The SDK path, with merkle proofs checked against the storage nodes. */
export async function downloadWithProof(root: string, indexer: string = GALILEO.indexer): Promise<Uint8Array> {
  const [blob, err] = await new Indexer(indexer).downloadToBlob(root, { proof: true });
  if (err || !blob) throw err ?? new Error(`download ${root} failed`);
  return new Uint8Array(await blob.arrayBuffer());
}
// 2026-11-06T08:12:00
// 2026-11-06T22:30:07
