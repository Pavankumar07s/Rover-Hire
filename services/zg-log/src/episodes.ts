// Episode files under data/: <id>.jsonl (records, append-only), <id>.json (state), images/<sha>.jpg (decision frames)
// and images/photo-<sha>.jpg (full photos, each also its own 0G Storage file).
// Every chain step is saved before the next one, so a restart resumes where it stopped.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GENESIS, recordHash, segmentBytes, sha256Hex, upload, type DecisionRecord, type EpisodeLog, type Segment, type Sent, type Upload,
} from "@0xBs/zg";
import { ZeroAddress, type Signer } from "ethers";
import { appendDurable, readJsonLines, writeDurable } from "./durable.js";
import type { SerialQueue } from "./queue.js";
import { watched } from "./watchdog.js";

// Uploads take 13 s typically and 66 s at most (377 uploads measured). The 0G SDK waits forever for the log entry of a
// storage tx that reverted (a live run, photo 3: status 0, stuck 7 min, the episode never ended); exiting lets systemd
// restart the service, which resumes from the saved state and uploads again.
const UPLOAD_STUCK_MS = 180_000;
const uploadOrRestart = (bytes: Uint8Array, signer: Signer) =>
  watched(upload(bytes, signer), UPLOAD_STUCK_MS, () => {
    console.error(`upload stuck over ${UPLOAD_STUCK_MS / 1000} s; exiting so systemd restarts and resumes`);
    process.exit(1);
  });

export interface SegmentState {
  index: number;
  first_seq: number;
  last_seq: number;
  bytes: number;
  root: string | null;
  upload: Upload | null;
  anchor: Sent | null;
}

export interface PhotoState {
  n: number;
  sha256: string; // = the photo record's photo.sha256, checked on arrival
  bytes: number;
  root: string | null; // its own 0G Storage file, downloadable from the indexer
  upload: Upload | null;
}

export interface EpisodeState {
  episode_id: string;
  mission_uri: string;
  started: Sent | null;
  segments: SegmentState[];
  ending: { safe_stops: number; decisions: number } | null;
  ended: Sent | null;
  errors: string[];
  photos?: Record<string, PhotoState>;
}

export class Episodes {
  private states = new Map<string, EpisodeState>();
  private records = new Map<string, DecisionRecord[]>();

  constructor(private dir: string, private log: EpisodeLog, private signer: Signer, private queue: SerialQueue) {
    mkdirSync(join(dir, "images"), { recursive: true });
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const s: EpisodeState = JSON.parse(readFileSync(join(dir, f), "utf8"));
      this.states.set(s.episode_id, s);
      const path = join(dir, `${s.episode_id}.jsonl`);
      this.records.set(s.episode_id, existsSync(path) ? readJsonLines<DecisionRecord>(path) : []);
    }
  }

  private save(s: EpisodeState): void {
    writeDurable(join(this.dir, `${s.episode_id}.json`), JSON.stringify(s, null, 2));
  }

  get(id: string): EpisodeState | undefined {
    return this.states.get(id);
  }

  all(): EpisodeState[] {
    return [...this.states.values()];
  }

  /** The last `n` records of an episode, for status views. */
  tail(id: string, n: number): DecisionRecord[] {
    return (this.records.get(id) ?? []).slice(-n);
  }

  count(id: string): number {
    return this.records.get(id)?.length ?? 0;
  }

  start(id: string, missionURI: string): EpisodeState {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) throw new Error("bad episode_id");
    const existing = this.states.get(id);
    if (existing) return existing;
    const s: EpisodeState = { episode_id: id, mission_uri: missionURI, started: null, segments: [], ending: null, ended: null, errors: [] };
    this.states.set(id, s);
    this.records.set(id, []);
    this.save(s);
    this.advance(s);
    return s;
  }

  /** Verifies the record against the stored chain. Returns "added", "duplicate", or throws. */
  add(record: DecisionRecord, image: Uint8Array | null): "added" | "duplicate" {
    const s = this.states.get(record.episode_id);
    if (!s) throw new Error("unknown episode");
    if (s.ending) throw new Error("episode is ending");
    const list = this.records.get(record.episode_id)!;
    const stored = list[record.seq];
    if (stored) {
      if (stored.hash === record.hash) return "duplicate";
      throw new Error(`seq ${record.seq} already stored with another hash`);
    }
    if (record.seq !== list.length) throw new Error(`expected seq ${list.length}, got ${record.seq}`);
    if (record.prev_hash !== (list.at(-1)?.hash ?? GENESIS)) throw new Error("prev_hash does not link to the last record");
    if (recordHash(record) !== record.hash) throw new Error("hash mismatch");
    const imagePath = join(this.dir, "images", `${record.img_sha256}.jpg`);
    if (image) {
      if (sha256Hex(image) !== record.img_sha256) throw new Error("image does not match img_sha256");
      writeDurable(imagePath, image);
    } else if (!existsSync(imagePath)) {
      throw new Error("image missing");
    }
    appendDurable(join(this.dir, `${record.episode_id}.jsonl`), JSON.stringify(record) + "\n");
    list.push(record);
    return "added";
  }

  /** A full photo: accepted only if it is the one its record names (sha256), then uploaded before the episode ends. */
  addPhoto(id: string, n: number, jpeg: Uint8Array): "added" | "duplicate" {
    const s = this.states.get(id);
    if (!s) throw new Error("unknown episode");
    if (s.ending) throw new Error("episode is ending");
    const record = this.records.get(id)!.find((r: any) => r.photo?.n === n) as any;
    if (!record) throw new Error(`no record for photo ${n}`);
    const sha = sha256Hex(jpeg);
    if (sha !== record.photo.sha256) throw new Error(`photo ${n} is not the photo its record names`);
    if (s.photos?.[n]?.sha256 === sha) return "duplicate";
    writeDurable(join(this.dir, "images", `photo-${sha}.jpg`), jpeg);
    s.photos = { ...s.photos, [n]: { n, sha256: sha, bytes: jpeg.length, root: null, upload: null } };
    this.save(s);
    this.advance(s);
    return "added";
  }

  end(id: string): EpisodeState {
    const s = this.states.get(id);
    if (!s) throw new Error("unknown episode");
    if (!s.ending) {
      const list = this.records.get(id)!;
      s.ending = { safe_stops: list.filter((r) => r.safe_stop).length, decisions: list.filter((r) => r.decision).length };
      this.save(s);
    }
    this.advance(s);
    return s;
  }

  /** Every SEGMENT_S, and once at startup: move each open episode on; a failed step is retried here. */
  tick(): void {
    for (const s of this.states.values()) if (!s.ended) this.advance(s);
  }

  private unsegmented(s: EpisodeState): number {
    return this.count(s.episode_id) - ((s.segments.at(-1)?.last_seq ?? -1) + 1);
  }

  private busy = new Set<string>();
  private again = new Set<string>();

  /** start → finish a half-done segment → cut the next one → end; queued at most once per episode. */
  private advance(s: EpisodeState): void {
    if (this.busy.has(s.episode_id)) {
      this.again.add(s.episode_id);
      return;
    }
    this.busy.add(s.episode_id);
    this.queue.run(async () => {
      try {
        if (!s.started) {
          s.started = (await this.recovered(s, "start")) ?? (await this.log.start(s.episode_id, s.mission_uri));
          this.save(s);
        }
        const open = s.segments.find((g) => !g.anchor);
        if (open) await this.finishSegment(s, open);
        // Ending flushes everything; records that arrived during an upload get their own segment before the end.
        do {
          if (this.unsegmented(s) === 0) break;
          const prev = s.segments.at(-1);
          const g: SegmentState = { index: s.segments.length, first_seq: prev ? prev.last_seq + 1 : 0,
                                    last_seq: this.count(s.episode_id) - 1, bytes: 0, root: null, upload: null, anchor: null };
          s.segments.push(g);
          this.save(s);
          await this.finishSegment(s, g);
        } while (s.ending);
        for (const p of Object.values(s.photos ?? {})) {
          if (p.upload) continue;
          p.upload = await uploadOrRestart(readFileSync(join(this.dir, "images", `photo-${p.sha256}.jpg`)), this.signer);
          p.root = p.upload.root;
          this.save(s);
        }
        if (s.ending && !s.ended && this.unsegmented(s) === 0 && s.segments.every((g) => g.anchor)
            && Object.values(s.photos ?? {}).every((p) => p.upload)) {
          s.ended = (await this.recovered(s, "end"))
            ?? (await this.log.end(s.episode_id, s.segments.at(-1)?.root ?? "0x" + GENESIS, s.ending.safe_stops, s.ending.decisions));
          this.save(s);
        }
      } catch (e) {
        s.errors.push(`${new Date().toISOString()} ${this.describe(e)}`.slice(0, 400));
        this.save(s);
      } finally {
        this.busy.delete(s.episode_id);
        if (this.again.delete(s.episode_id)) this.advance(s);
      }
    });
  }

  segment(s: EpisodeState, g: SegmentState): Segment {
    const records = this.records.get(s.episode_id)!.slice(g.first_seq, g.last_seq + 1);
    const images: Record<string, string> = {};
    for (const r of records) images[r.img_sha256] = readFileSync(join(this.dir, "images", `${r.img_sha256}.jpg`)).toString("base64");
    const prevRoot = g.index === 0 ? null : s.segments[g.index - 1]!.root;
    return { v: 1, episode_id: s.episode_id, segment_index: g.index, prev_segment_root: prevRoot, first_seq: g.first_seq, last_seq: g.last_seq, records, images };
  }

  private async finishSegment(s: EpisodeState, g: SegmentState): Promise<void> {
    if (!g.upload) {
      const bytes = segmentBytes(this.segment(s, g));
      g.upload = await uploadOrRestart(bytes, this.signer);
      g.root = g.upload.root;
      g.bytes = bytes.length;
      this.save(s);
    }
    if (!g.anchor) {
      g.anchor = (await this.recovered(s, "anchor", g.index))
        ?? (await this.log.anchor(s.episode_id, g.index, g.root!, g.first_seq, g.last_seq));
      this.save(s);
    }
  }

  /** A step whose tx landed before a crash (state not saved yet): rebuild it from the chain instead of resending. */
  private async recovered(s: EpisodeState, step: "start" | "anchor" | "end", index = 0): Promise<Sent | null> {
    const chain = await this.log.state(s.episode_id);
    const done = step === "start" ? chain.rover !== ZeroAddress : step === "anchor" ? chain.segments > index : chain.ended;
    if (!done) return null;
    const from = s.started?.block ?? Math.max(0, (await this.signer.provider!.getBlockNumber()) - 50_000);
    const ev = await this.log.events(s.episode_id, from);
    const tx = step === "start" ? ev.startedTx : step === "anchor" ? ev.segments.find((x) => x.segIndex === index)?.tx : ev.ended?.tx;
    const receipt = tx ? await this.signer.provider!.getTransactionReceipt(tx) : null;
    if (!receipt) throw new Error(`${step} ${index} is on chain but its event was not found`);
    s.errors.push(`${new Date().toISOString()} recovered ${step}${step === "anchor" ? " " + index : ""} from the chain`);
    return { tx: receipt.hash, block: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(),
             feeWei: (receipt.gasUsed * receipt.gasPrice).toString(), seconds: 0 };
  }

  private describe(e: unknown): string {
    const data = (e as { data?: string }).data;
    const name = data ? this.log.contract.interface.parseError(data)?.name : undefined;
    return name ? `contract reverted ${name}` : (e as Error).message;
  }
}


// Rebuild a segment from the chain if zg-log crashed after anchorSegment
// returned but before it wrote the success flag locally.
// The EpisodeLog SegmentAnchored event contains the root; download and verify.
export async function recoverMissingSegment(episodeId: string, segIdx: number) {
  const event = await findAnchorEvent(episodeId, segIdx);
  if (!event) return null;
  const data = await downloadSegment(event.root);
  return verifySegment(data) ? data : null;
}
