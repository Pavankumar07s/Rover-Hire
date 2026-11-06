// Episodes straight from the EpisodeLog's events on 0G Galileo, filtered by the rover that started them.
import { EPISODE_LOG_ABI, GALILEO, episodeKey } from "@0xBs/zg/browser";
import { Contract, JsonRpcProvider, type EventLog } from "ethers";
import { DEPLOY_BLOCK } from "./config";
import { pool } from "./util";

export interface Anchor { segIndex: number; root: string; firstSeq: number; lastSeq: number; tx: string; block: number }

export interface Episode {
  id: string; // the mission URI's quote_id; idMatches says whether it hashes to the on-chain key
  idMatches: boolean;
  key: string;
  mission: string;
  photosWanted: number | null;
  startTx: string;
  startedAt: number; // ms
  segments: Anchor[];
  ended: { finalRoot: string; safeStops: number; decisions: number; tx: string } | null;
}

export const galileo = () => new JsonRpcProvider(GALILEO.rpc, GALILEO.chainId, { staticNetwork: true });

function missionOf(uri: string): { quote_id?: string; mission?: string; photos_wanted?: number } {
  try {
    const [head, body] = uri.split(",", 2);
    return JSON.parse(head!.endsWith(";base64") ? atob(body!) : decodeURIComponent(body!));
  } catch {
    return {};
  }
}

export async function listEpisodes(log: string, rover: string): Promise<Episode[]> {
  const provider = galileo();
  const c = new Contract(log, EPISODE_LOG_ABI, provider);
  const f = c.filters;
  // Only the rover that started an episode can anchor or end it (NotRover), so these need no rover filter.
  const [started, anchored, ended] = (await Promise.all([
    c.queryFilter(f.EpisodeStarted!(null, rover), DEPLOY_BLOCK),
    c.queryFilter(f.SegmentAnchored!(), DEPLOY_BLOCK),
    c.queryFilter(f.EpisodeEnded!(), DEPLOY_BLOCK),
  ])) as EventLog[][];
  const times = await pool(started!, 6, async (e) => ((await provider.getBlock(e.blockNumber))?.timestamp ?? 0) * 1000);
  return started!.map((s, i): Episode => {
    const key = s.args.episodeId as string;
    const m = missionOf(s.args.missionURI);
    const id = m.quote_id ?? key;
    const end = ended!.find((e) => e.args.episodeId === key);
    return {
      id, idMatches: !!m.quote_id && episodeKey(m.quote_id) === key, key,
      mission: m.mission ?? "", photosWanted: m.photos_wanted ?? null, startTx: s.transactionHash, startedAt: times[i]!,
      segments: anchored!.filter((a) => a.args.episodeId === key)
        .map((a) => ({ segIndex: Number(a.args.segIndex), root: a.args.root, firstSeq: Number(a.args.firstSeq), lastSeq: Number(a.args.lastSeq),
                       tx: a.transactionHash, block: a.blockNumber }))
        .sort((a, b) => a.segIndex - b.segIndex),
      ended: end ? { finalRoot: end.args.finalRoot, safeStops: Number(end.args.safeStops), decisions: Number(end.args.decisions), tx: end.transactionHash } : null,
    };
  }).reverse();
}
// 2026-11-06T20:34:00
// 2026-11-06T23:07:59


// Use the public HTTPS 0G Storage indexer — no credentials needed.
// CORS is allowed from the deployed origin by the indexer.
// Chunk EpisodeStarted event reads into 500-block windows to stay under rate limits.
export const ZG_INDEXER = "https://indexer-storage-testnet-standard.0g.ai";
export const BLOCK_WINDOW = 500;
