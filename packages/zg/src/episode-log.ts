// EpisodeLog on Galileo (contracts/episode-log): writes run one at a time from a single signer (nonce-safe).
import { Contract, id, type ContractRunner, type ContractTransactionResponse, type EventLog } from "ethers";

export const EPISODE_LOG_ABI = [
  "event EpisodeStarted(bytes32 indexed episodeId, address indexed rover, string missionURI)",
  "event SegmentAnchored(bytes32 indexed episodeId, uint32 indexed segIndex, bytes32 root, uint64 firstSeq, uint64 lastSeq)",
  "event EpisodeEnded(bytes32 indexed episodeId, bytes32 finalRoot, uint32 safeStops, uint64 decisions)",
  "error Exists()",
  "error NotRover()",
  "error AlreadyEnded()",
  "error BadIndex()",
  "function episodes(bytes32) view returns (address rover, uint32 segments, bool ended)",
  "function startEpisode(bytes32 episodeId, string missionURI)",
  "function anchorSegment(bytes32 episodeId, uint32 segIndex, bytes32 root, uint64 firstSeq, uint64 lastSeq)",
  "function endEpisode(bytes32 episodeId, bytes32 finalRoot, uint32 safeStops, uint64 decisions)",
];

/** On-chain key of an episode: keccak256 of its UTF-8 id. */
export const episodeKey = (episodeId: string): string => id(episodeId);

export interface Sent {
  tx: string;
  block: number;
  gasUsed: string;
  feeWei: string;
  seconds: number;
}

export interface EpisodeEvents {
  started: { rover: string; missionURI: string; block: number } | null;
  startedTx: string | null;
  segments: { segIndex: number; root: string; firstSeq: number; lastSeq: number; tx: string; block: number }[];
  ended: { finalRoot: string; safeStops: number; decisions: number; tx: string } | null;
}

export class EpisodeLog {
  readonly contract: Contract;

  constructor(address: string, runner: ContractRunner) {
    this.contract = new Contract(address, EPISODE_LOG_ABI, runner);
  }

  private async send(call: Promise<ContractTransactionResponse>): Promise<Sent> {
    const t0 = performance.now();
    const receipt = await (await call).wait();
    if (!receipt || receipt.status !== 1) throw new Error("transaction failed");
    return { tx: receipt.hash, block: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(),
             feeWei: (receipt.gasUsed * receipt.gasPrice).toString(), seconds: Math.round(performance.now() - t0) / 1000 };
  }

  start(episodeId: string, missionURI: string): Promise<Sent> {
    return this.send(this.contract.getFunction("startEpisode")(episodeKey(episodeId), missionURI));
  }

  anchor(episodeId: string, segIndex: number, root: string, firstSeq: number, lastSeq: number): Promise<Sent> {
    return this.send(this.contract.getFunction("anchorSegment")(episodeKey(episodeId), segIndex, root, firstSeq, lastSeq));
  }

  end(episodeId: string, finalRoot: string, safeStops: number, decisions: number): Promise<Sent> {
    return this.send(this.contract.getFunction("endEpisode")(episodeKey(episodeId), finalRoot, safeStops, decisions));
  }

  async state(episodeId: string): Promise<{ rover: string; segments: number; ended: boolean }> {
    const s = await this.contract.getFunction("episodes")(episodeKey(episodeId));
    return { rover: s.rover, segments: Number(s.segments), ended: s.ended };
  }

  async events(episodeId: string, fromBlock: number): Promise<EpisodeEvents> {
    const key = episodeKey(episodeId);
    const f = this.contract.filters;
    const [started, anchored, ended] = (await Promise.all([
      this.contract.queryFilter(f.EpisodeStarted!(key), fromBlock),
      this.contract.queryFilter(f.SegmentAnchored!(key), fromBlock),
      this.contract.queryFilter(f.EpisodeEnded!(key), fromBlock),
    ])) as EventLog[][];
    const s = started![0];
    const e = ended![0];
    return {
      started: s ? { rover: s.args.rover, missionURI: s.args.missionURI, block: s.blockNumber } : null,
      startedTx: s ? s.transactionHash : null,
      segments: anchored!.map((a) => ({ segIndex: Number(a.args.segIndex), root: a.args.root, firstSeq: Number(a.args.firstSeq),
                                        lastSeq: Number(a.args.lastSeq), tx: a.transactionHash, block: a.blockNumber })),
      ended: e ? { finalRoot: e.args.finalRoot, safeStops: Number(e.args.safeStops), decisions: Number(e.args.decisions), tx: e.transactionHash } : null,
    };
  }
}
// 2026-11-06T08:26:00
// 2026-11-06T23:03:15
