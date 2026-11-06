// Server only: one telemetry socket to the rover and a few pollers, merged into a Snapshot that every open page gets.
import { CHAINS, chainOfTx, HASHSCAN, mirror, txIdToMirror, usdcString } from "@0xBs/hedera/browser";
import { config, roverHeaders, type Role } from "./config";
import type { Checkpoint, Payment, Segment, Snapshot, TopicMessage } from "./types";

type Listener = (s: Snapshot) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- topic messages are other services' JSON
type Raw = { role: Role; topic: string; seq: number; ts: string; text: string; json: any };

const FEED_BEFORE_S = 600; // the haggling is logged a little before the rover starts

const get = async (url: string, headers?: Record<string, string>, timeoutMs = 2500) => {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

const parse = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const missionOf = (uri: string | undefined) => parse(Buffer.from(uri?.split(",")[1] ?? "", "base64").toString("utf8")) ?? {};

class Hub {
  private listeners = new Set<Listener>();
  private dirty = true;
  private socket: WebSocket | null = null;
  private quote: string | null = null;
  private triedRover = 0;
  private consensus = new Map<string, string>();
  private firstSeen = new Map<string, number>(); // Base / Solana payment → when first seen (unix seconds)
  private roverPhotos: number[] = [];
  private zgPhotos: Record<string, { root: string | null }> = {};
  private txs = new Set<string>();
  private feed = { quote: "", after: {} as Record<string, string>, raw: [] as Raw[] };
  private arrivals = new Map<string, number>();
  private primed = new Set<string>();
  private snap: Snapshot = {
    at: 0, rover: "offline", mcu: null, leases: null, live: false, mission: null, photos: [], prices: null, movesPaid: 0, photosPaid: 0,
    payments: [], records: [], checkpoints: 0, segments: [], ended: null, topics: config.topics.map((t) => ({ ...t, seq: null })), messages: [],
  };

  constructor() {
    this.connect();
    this.every(1000, () => this.pollRover());
    this.every(1500, () => this.pollMission());
    this.every(1500, () => this.pollShop());
    this.every(5000, () => this.pollTopics());
    setInterval(() => this.flush(), 250);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snap);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch, at: Date.now() };
    this.dirty = true;
  }

  private flush() {
    if (!this.dirty) return;
    this.dirty = false;
    for (const fn of this.listeners) fn(this.snap);
  }

  private every(ms: number, fn: () => Promise<void>) {
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      await fn().catch(() => {});
      busy = false;
    };
    void run();
    setInterval(run, ms);
  }

  /** Points every mission panel at another mission, empty until that mission's own data comes in. */
  private follow(quote: string, m: { mission?: string; photos_wanted?: number }) {
    this.quote = quote;
    this.roverPhotos = [];
    this.zgPhotos = {};
    this.txs = new Set();
    this.feed = { quote, after: {}, raw: [] };
    this.arrivals.clear();
    this.primed.clear();
    this.set({ mission: { quote_id: quote, mission: m.mission ?? "", photos_wanted: m.photos_wanted ?? 0, started_ms: null }, photos: [],
               prices: null, movesPaid: 0, photosPaid: 0, payments: [], records: [], checkpoints: 0, segments: [], ended: null, messages: [] });
  }

  /** Stamps each row with when it first showed up; rows there on the first read of a mission count as old (0). */
  private stamp<T>(list: string, rows: T[], key: (r: T) => string | number): (T & { seen: number })[] {
    const old = !this.primed.has(list);
    this.primed.add(list);
    return rows.map((r) => {
      const k = `${list}:${key(r)}`;
      if (!this.arrivals.has(k)) this.arrivals.set(k, old ? 0 : Date.now());
      return { ...r, seen: this.arrivals.get(k)! };
    });
  }

  /** The rover's 20 Hz telemetry: sonar, heading, battery, face and the three leases. */
  private connect() {
    const ws = new WebSocket(`${config.roverUrl.replace(/^http/, "ws")}/telemetry`, { headers: roverHeaders() } as never);
    this.socket = ws;
    ws.onmessage = (e) => {
      const d = JSON.parse(String(e.data));
      this.set({ rover: "online", mcu: d.mcu, leases: d.leases, live: d.mission });
    };
    ws.onclose = () => {
      if (this.socket === ws) setTimeout(() => this.connect(), this.snap.rover === "online" ? 1000 : 5000);
    };
    ws.onerror = () => ws.close();
  }

  private async pollRover() {
    if (this.snap.rover === "offline" && Date.now() - this.triedRover < 5000) return; // offline: try every 5 s
    this.triedRover = Date.now();
    try {
      const s = await get(`${config.roverUrl}/status`, roverHeaders());
      if (s.mission && s.mission.quote_id !== this.quote) this.follow(s.mission.quote_id, s.mission);
      if (s.mission) this.roverPhotos = s.photos.map((p: { n: number }) => p.n);
      this.set({ rover: "online", live: !!s.mission });
      this.setPhotos();
    } catch {
      this.set({ rover: "offline", mcu: null, leases: null, live: false });
    }
  }

  /** The current mission, or with the rover idle the last one zg-log has. */
  private async pollMission() {
    const quote = this.quote;
    const all = await get(`${config.zgLogUrl}/segments${quote ? `?episode_id=${quote}` : ""}`);
    // zg-log lists episodes unordered; the Galileo block of each start orders them in time.
    const ep = quote ? all[0]
      : all.filter((e: { started?: { block: number } }) => e.started).sort((a: { started: { block: number } }, b: { started: { block: number } }) => b.started.block - a.started.block)[0];
    if (!ep || quote !== this.quote) return;
    const m = missionOf(ep.mission_uri);
    if (!quote) this.follow(ep.episode_id, m);
    const records = await get(`${config.zgLogUrl}/records?episode_id=${ep.episode_id}&last=500`);
    if (ep.episode_id !== this.quote) return;
    const rows: (Omit<Checkpoint, "seen"> & { t_frame_ms: number })[] = records.last;
    const checkpoints = rows.map(({ seq, request_id, skill, see, reason, safe_stop, stop_detail, verified, latency_ms, photo }) =>
      ({ seq, request_id, skill, see, reason, safe_stop, stop_detail, verified, latency_ms, photo })).reverse();
    type Stored = Omit<Segment, "anchor" | "seen"> & { anchor?: { tx: string } };
    const segments: Omit<Segment, "seen">[] = (ep.segments ?? []).map((s: Stored) => ({ index: s.index, first_seq: s.first_seq, last_seq: s.last_seq, root: s.root,
                                                             anchor: s.anchor?.tx ?? null })).reverse();
    this.zgPhotos = ep.photos ?? {};
    this.set({
      mission: { quote_id: ep.episode_id, mission: m.mission ?? "", photos_wanted: m.photos_wanted ?? 0,
                 started_ms: rows[0]?.seq === 0 ? rows[0].t_frame_ms : this.snap.mission?.started_ms ?? null },
      records: this.stamp("records", checkpoints, (r) => r.seq), checkpoints: records.records,
      segments: this.stamp("segments", segments, (s) => s.index), ended: ep.ended?.tx ?? null,
    });
    this.setPhotos();
  }

  /** Payments, from the shop; apart from the rest, as the shop asks the rover first and waits when it is offline. */
  private async pollShop() {
    const quote = this.quote;
    if (!quote) return;
    const shop = await get(`${config.shopUrl}/missions/${quote}/status`, undefined, 8000);
    const payments = await this.payments(shop);
    if (quote !== this.quote) return;
    this.txs = new Set(payments.map((p) => p.tx));
    this.set({ prices: { move: usdcString(shop.move), photo: usdcString(shop.photo) }, movesPaid: shop.moves_paid,
               photosPaid: shop.photos_paid.length, payments: this.stamp("payments", payments, (p) => p.tx) });
  }

  /** Delivered photos, newest first: the rover's list while it runs, with each 0G Storage root once zg-log has uploaded it. */
  private setPhotos() {
    const ns = this.snap.live ? this.roverPhotos : Object.keys(this.zgPhotos).map(Number);
    const photos = [...ns].sort((a, b) => b - a).map((n) => ({ n, root: this.zgPhotos[n]?.root ?? null }));
    this.set({ photos: this.stamp("photos", photos, (p) => p.n) });
  }

  /** When a payment was made: a Hedera transaction id carries its time; a Base hash or a Solana signature does not, so
   *  those are timed by when this page first saw them. */
  private paidAt(tx: string): number {
    const hedera = /^\d+\.\d+\.\d+@(\d+\.\d+)$/.exec(tx);
    if (hedera) return Number(hedera[1]);
    if (!this.firstSeen.has(tx)) this.firstSeen.set(tx, Date.now() / 1000);
    return this.firstSeen.get(tx)!;
  }

  /** The mission's payments with their explorer links, newest first. HashScan opens a Hedera transaction by its consensus
   *  timestamp; a Base or Solana payment links straight to BaseScan or Solana Explorer. */
  private async payments(shop: { move_txs?: string[]; photo_txs?: Record<string, string> }): Promise<Omit<Payment, "seen">[]> {
    const all = [
      ...(shop.move_txs ?? []).map((tx, i) => ({ kind: "move" as const, n: i + 1, tx })),
      ...Object.entries(shop.photo_txs ?? {}).map(([n, tx]) => ({ kind: "photo" as const, n: Number(n), tx })),
    ].sort((a, b) => this.paidAt(b.tx) - this.paidAt(a.tx) || b.n - a.n);
    const onHedera = (tx: string) => (chainOfTx(tx) ?? CHAINS.hedera).chain === "hedera";
    await Promise.all(all.filter((p) => onHedera(p.tx) && !this.consensus.has(p.tx)).map(async (p) => {
      const d = await mirror(`/api/v1/transactions/${txIdToMirror(p.tx)}`).catch(() => null);
      const ts = d?.transactions?.[0]?.consensus_timestamp;
      if (ts) this.consensus.set(p.tx, ts);
    }));
    return all.map((p) => ({ ...p, link: !onHedera(p.tx) ? chainOfTx(p.tx)!.txUrl(p.tx)
      : this.consensus.has(p.tx) ? `${HASHSCAN}/transaction/${this.consensus.get(p.tx)}` : `${HASHSCAN}/search-result?q=${encodeURIComponent(p.tx)}` }));
  }

  private async pollTopics() {
    const topics = await Promise.all(this.snap.topics.map(async (t) => {
      const d = await mirror(`/api/v1/topics/${t.topic}/messages?order=desc&limit=1`).catch(() => null);
      return { ...t, seq: d?.messages?.[0]?.sequence_number ?? t.seq };
    }));
    this.set({ topics });
    await this.pollFeed();
  }

  /** The mission's own messages on the three topics, each read once from the mirror node, from a little before it began. */
  private async pollFeed() {
    const quote = this.quote;
    const start = this.snap.mission?.started_ms ?? (this.snap.live ? Date.now() : null); // a past mission: wait for its start
    if (!quote || start == null) return;
    if (this.feed.quote !== quote) this.feed = { quote, after: {}, raw: [] };
    const feed = this.feed;
    for (const t of config.topics) {
      let path: string | null = `/api/v1/topics/${t.topic}/messages?order=asc&limit=100&timestamp=gt:${feed.after[t.topic] ?? (start / 1000 - FEED_BEFORE_S).toFixed(9)}`;
      while (path) {
        const d: { messages?: { sequence_number: number; consensus_timestamp: string; message: string }[]; links?: { next: string | null } } | null = await mirror(path);
        if (this.feed !== feed) return;
        for (const x of d?.messages ?? []) {
          const text = Buffer.from(x.message, "base64").toString("utf8");
          feed.raw.push({ role: t.role, topic: t.name, seq: x.sequence_number, ts: x.consensus_timestamp, text, json: parse(text) });
          feed.after[t.topic] = x.consensus_timestamp;
        }
        path = d?.links?.next ?? null;
      }
    }
    // The buyer's log names no mission: a payment is this mission's by its transaction, a refusal by falling between its start and end.
    const shop = feed.raw.filter((r) => r.role === "shop" && r.json?.quote_id === quote);
    const from = shop.find((r) => r.json.type === "quote")?.ts;
    const to = shop.find((r) => r.json.type === "end")?.ts;
    const during = (ts: string) => !!from && ts >= from && (!to || ts <= to);
    const messages: Omit<TopicMessage, "seen">[] = [];
    for (const r of feed.raw) {
      const text = this.said(r, quote, during);
      if (text) messages.push({ role: r.role, topic: r.topic, seq: r.seq, ts: r.ts, text, link: `${HASHSCAN}/transaction/${r.ts}` });
    }
    messages.sort((a, b) => b.ts.localeCompare(a.ts));
    if (this.feed !== feed) return; // the mission changed while the topics were read
    this.set({ messages: this.stamp("messages", messages, (x) => `${x.topic}:${x.seq}`) });
  }

  /** One topic message in plain words, or null when it belongs to another mission. */
  private said(r: Raw, quote: string, during: (ts: string) => boolean): string | null {
    const j = r.json;
    if (r.role === "shop") {
      if (j?.quote_id !== quote) return null;
      if (j.type === "quote") return `Mission started: ${usdcString(j.amount)} USDC a move, ${usdcString(j.photo_price)} a photo`;
      if (j.type === "move") return `Move paid, ${usdcString(j.amount)} USDC`;
      if (j.type === "photo") return `Photo ${j.photo} paid, ${usdcString(j.amount)} USDC`;
      if (j.type === "end") return `Mission closed: ${j.moves_paid} moves and ${j.photos_paid} photos paid`;
      return String(j.type);
    }
    if (r.role === "buyer") {
      if (j?.decision === "paid") return this.txs.has(j.tx) ? `Buyer paid for a ${j.kind}, ${usdcString(j.amount)} USDC` : null;
      return j && during(r.ts) ? `Buyer refused a ${j.kind}: ${j.reason}` : null;
    }
    if (!r.text.includes(quote)) return null;
    if (j?.type === "negotiation") return `Haggled with ${j.offers.length} rovers, chose agent #${j.chosen}`;
    const tool = /Agent executed tool (\w+)/.exec(r.text)?.[1];
    if (tool === "pay_x402_request") return `Agent Kit paid for a ${/"kind": "(\w+)"/.exec(r.text)?.[1] ?? "request"}`;
    if (tool === "submit_topic_message_tool") return "Agent Kit logged the haggling";
    return tool ? `Agent Kit ran ${tool}` : "Audit note";
  }
}

const g = globalThis as unknown as { roverHud?: Hub };
export const hub = () => (g.roverHud ??= new Hub());
// 2026-11-06T19:24:00
// 2026-11-06T23:06:48


// Rover token is never forwarded to the browser.
// The Next.js API route proxies /status and /telemetry server-side only.
// WS endpoint /telemetry is bridged through a server-side WebSocket relay.
export const ROVER_TOKEN = process.env.ROVER_LAN_TOKEN!; // server-side only
export const ROVER_URL   = process.env.ROVER_URL ?? "http://rover.local:8700";
