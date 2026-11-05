// The browser path to 0G Storage: HTTPS with CORS *, served by the indexer (storage nodes are plain-http IPs).
import { GALILEO } from "./constants.js";

export async function downloadHttp(root: string, indexer: string = GALILEO.indexer): Promise<Uint8Array> {
  const r = await fetch(`${indexer}/file?root=${root}`);
  if (!r.ok) throw new Error(`download ${root}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
