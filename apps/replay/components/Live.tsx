"use client";

import { CHAINS, chainOfTx } from "@0xBs/hedera/browser";
import { GALILEO, GENESIS, readTeeService, type TeeService } from "@0xBs/zg/browser";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArchPage } from "@/components/arch";
import { Pixel, PixelLoader } from "@/components/pixel";
import { Ext, Status } from "@/components/ui";
import { DEFAULT_LOG, DEFAULT_ROVER } from "@/lib/config";
import { headline, kindOf } from "@/lib/describe";
import { galileo, listEpisodes, type Episode } from "@/lib/episodes";
import { chainSince, feedSince, loadSegment, paymentLink, type FeedItem, type LiveSegment } from "@/lib/live";
import { short } from "@/lib/util";

const CHAIN_MS = 8000; // Galileo events
const FEED_MS = 4000; // Hedera mirror, while a mission runs
const FEED_BEFORE_S = 600; // the haggling is logged a little before the mission starts

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 172800) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** setInterval that skips while the tab is hidden and never overlaps a slow run. */
function useEvery(ms: number, fn: () => Promise<void>, on: boolean) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    if (!on) return;
    let busy = false;
    const run = async () => {
      if (busy || document.hidden) return;
      busy = true;
      await ref.current().catch(() => {});
      busy = false;
    };
    void run();
    const t = setInterval(run, ms);
    return () => clearInterval(t);
  }, [ms, on]);
}

const KIND_TONE = { move: "text-move", photo: "text-photo", pause: "text-pause" } as const;

export function Live() {
  const [ep, setEp] = useState<Episode | null | undefined>(undefined); // undefined while loading
  const [error, setError] = useState<string | null>(null);
  const [tee, setTee] = useState<TeeService | null>(null);
  const [segs, setSegs] = useState<LiveSegment[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const block = useRef(0);
  const cursor = useRef<string | null>(null);
  const loading = useRef(false);
  const [retry, setRetry] = useState(0);
  const now = useNow();
  // ?mission=<quote id> follows that mission, running or finished, instead of the newest one.
  const follow = useSyncExternalStore(() => () => {}, () => new URLSearchParams(window.location.search).get("mission"), () => null);

  const refresh = useCallback(async () => {
    const [eps, to] = await Promise.all([listEpisodes(DEFAULT_LOG, DEFAULT_ROVER), galileo().getBlockNumber()]);
    block.current = to;
    const latest = (follow ? eps.find((e) => e.id === follow) : eps[0]) ?? null; // newest first
    setEp((cur) => {
      if (cur?.id !== latest?.id) {
        setSegs([]);
        setFeed([]);
        cursor.current = null;
      }
      return latest;
    });
    setError(null);
  }, [follow]);

  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
    readTeeService().then(setTee).catch(() => setTee(null));
  }, [refresh]);

  const live = !!ep && !ep.ended;
  const show = live || (!!ep && !!follow);

  useEvery(CHAIN_MS, async () => {
    const r = await chainSince(block.current + 1);
    if (r.changed) return refresh();
    block.current = r.to;
    const mine = r.anchored.filter((a) => a.key === ep?.key);
    if (mine.length) setEp((cur) => cur && { ...cur, segments: [...cur.segments, ...mine.filter((a) => !cur.segments.some((s) => s.segIndex === a.segIndex))]
      .sort((a, b) => a.segIndex - b.segIndex) });
  }, ep !== undefined);

  useEvery(FEED_MS, async () => {
    if (!ep) return;
    const { items, cursor: next } = await feedSince(ep.id, cursor.current ?? (ep.startedAt / 1000 - FEED_BEFORE_S).toFixed(9));
    cursor.current = next;
    if (items.length) setFeed((cur) => [...items.reverse(), ...cur]);
    for (const it of items) if (it.tx) paymentLink(it.tx).then((l) => setLinks((cur) => ({ ...cur, [it.tx!]: l })));
  }, show);

  // Batches load in order, each checked against the one before it, as soon as it is anchored.
  useEffect(() => {
    if (!show || !ep || !tee || loading.current || segs.length >= ep.segments.length) return;
    loading.current = true;
    const prev = segs.at(-1);
    loadSegment(ep.segments[segs.length]!, prev?.anchor.root ?? null, prev?.lastHash ?? GENESIS, tee).then((s) => {
      loading.current = false;
      setSegs((cur) => (cur.length === segs.length ? [...cur, s] : cur));
    }, () => {
      loading.current = false;
      setTimeout(() => setRetry((r) => r + 1), 5000); // the indexer can lag a moment behind the anchor
    });
  }, [show, ep, tee, segs, retry]);

  if (ep === undefined) {
    return <ArchPage><Top /><div className="grid min-h-[50vh] place-items-center">{error ? <p className="text-bad">{error}</p> : <PixelLoader label="Reading 0G and Hedera" />}</div></ArchPage>;
  }

  const steps = segs.flatMap((s) => s.steps);
  const latest = [...steps].reverse().find((s) => s.frame);
  const moves = feed.filter((f) => f.kind === "move").length;
  const photos = feed.filter((f) => f.kind === "photo").length;
  const usdc = feed.reduce((a, f) => a + f.usdc, 0);
  const allOk = segs.length > 0 && segs.every((s) => s.ok);

  return (
    <ArchPage>
      <Top live={live} />
      {ep && show ? (
        <section className="border-y border-night-rule py-6">
          <p className={`flex items-center gap-3 font-label text-sm uppercase tracking-widest ${live ? "text-accent" : "text-chalk-2"}`}>
            <span className={`h-3 w-3 ${live ? "animate-pulse bg-accent" : "bg-night-rule"}`} aria-hidden />{live ? "On a mission now" : "A finished mission, followed from public data"}
          </p>
          <p className="mt-3 font-pixel text-4xl leading-tight sm:text-5xl">{ep.mission || "Mission"}</p>
          <p className="mt-3 text-chalk-2">Rover-A · started {ago(now - ep.startedAt)}{live && <> · running for <span className="text-chalk">{clock(now - ep.startedAt)}</span></>}
            {" · "}quote <span className="font-mono">{ep.id}</span>{ep.photosWanted ? ` · ${ep.photosWanted} photos ordered` : ""}</p>
        </section>
      ) : (
        <Idle ep={ep} now={now} />
      )}

      {show && (
        <>
          <div className="grid grid-cols-2 gap-px border-b border-night-rule bg-night-rule sm:grid-cols-5">
            <Tile n={`${photos}${ep.photosWanted ? `/${ep.photosWanted}` : ""}`} label="photos paid" />
            <Tile n={`${moves}`} label="moves paid" />
            <Tile n={usdc.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} label="USDC paid" />
            <Tile n={`${steps.length}`} label="steps saved on 0G" />
            <Tile n={`${segs.length}`} label={allOk ? "batches, all re-checked" : "batches anchored"} />
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <Panel title="What the rover saw" note="from 0G Storage, about a minute behind">
                {latest ? (
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a frame from 0G Storage, as a data URL */}
                    <img src={latest.frame!} alt={`What the rover's camera showed 0G at step ${latest.record.seq + 1}`} className="aspect-[4/3] w-full border border-night-rule object-cover" />
                    <figcaption className="mt-4">
                      <p className={`font-pixel text-2xl ${KIND_TONE[kindOf(latest.record)]}`}>{headline(latest.record)}</p>
                      {latest.record.decision?.see && <p className="mt-2 text-chalk">“{String(latest.record.decision.see)}”</p>}
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-chalk-2">
                        <span>step {latest.record.seq + 1}</span>
                        <span>{ago(now - Number(latest.record.t_frame_ms))}</span>
                        {latest.audit.signature && <Status ok={latest.audit.signature.verified} night>{latest.audit.signature.verified ? "signed inside 0G's TEE" : "signature does not check"}</Status>}
                      </div>
                    </figcaption>
                  </figure>
                ) : <Waiting>The first batch reaches 0G Storage about a minute after the mission starts.</Waiting>}
              </Panel>
              {steps.length > 0 && (
                <Panel title="Decisions" note={`${steps.length} so far, newest first`}>
                  <ol className="divide-y divide-night-rule">
                    {[...steps].reverse().slice(0, 10).map((s) => (
                      <li key={s.record.seq} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 py-2 text-sm">
                        <span className="text-chalk-2">{s.record.seq + 1}</span>
                        <span className={`min-w-0 truncate ${KIND_TONE[kindOf(s.record)]}`}>{headline(s.record)}</span>
                        {s.audit.signature ? <Status ok={s.audit.ok} night>{s.audit.ok ? "TEE" : "fails"}</Status> : <span className="text-chalk-2">paused</span>}
                      </li>
                    ))}
                  </ol>
                </Panel>
              )}
            </div>

            <div className="lg:col-span-5">
              <Panel title="Payments, logged on Hedera" note="seconds behind">
                {feed.length ? (
                  <ul className="divide-y divide-night-rule">
                    {feed.slice(0, 14).map((f) => (
                      <li key={`${f.ts}-${f.kind}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Pixel name={f.kind === "photo" ? "camera" : f.kind === "move" ? "coin" : f.kind === "deal" ? "card" : "flag"} size={14} grid={false}
                            className={f.kind === "photo" ? "text-photo" : f.kind === "move" ? "text-move" : "text-chalk-2"} />
                          <span className="truncate">{f.text}</span>
                        </span>
                        {f.tx && links[f.tx] ? <Ext href={links[f.tx]!}>{(chainOfTx(f.tx) ?? CHAINS.hedera).explorer}</Ext> : <span className="shrink-0 text-chalk-2">{ago(now - Number(f.ts) * 1000)}</span>}
                      </li>
                    ))}
                  </ul>
                ) : <Waiting>Reading the rover&apos;s payment topic on Hedera…</Waiting>}
              </Panel>
              <Panel title="Saved on 0G" note="a batch every minute, anchored on Galileo">
                {ep.segments.length ? (
                  <ul className="divide-y divide-night-rule">
                    {[...ep.segments].reverse().map((a) => {
                      const s = segs.find((x) => x.anchor.segIndex === a.segIndex);
                      return (
                        <li key={a.segIndex} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
                          <span>steps {a.firstSeq + 1}–{a.lastSeq + 1} · <span className="font-mono">{short(a.root, 4)}</span></span>
                          <span className="flex items-center gap-3">
                            {s ? <Status ok={s.ok} night>{s.ok ? "re-checked" : "fails"}</Status> : <span className="text-chalk-2">checking…</span>}
                            <Ext href={`${GALILEO.explorer}/tx/${a.tx}`}>anchored</Ext>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : <Waiting>The first batch is anchored about a minute in.</Waiting>}
                <p className="mt-3 text-sm"><Ext href={`${GALILEO.explorer}/tx/${ep.startTx}`}>Mission started on Galileo</Ext></p>
              </Panel>
            </div>
          </div>
        </>
      )}

      <section className="mt-12 grid gap-6 border-t border-night-rule pt-8 text-sm leading-relaxed text-chalk-2 sm:grid-cols-3">
        <p><span className="block font-label text-xs uppercase tracking-widest text-chalk">No server of ours</span>
          This page reads Hedera&apos;s mirror node, 0G&apos;s Galileo chain and 0G Storage straight from your browser, and re-checks every batch here.</p>
        <p><span className="block font-label text-xs uppercase tracking-widest text-chalk">Why some things lag</span>
          Payments show within seconds. The rover&apos;s view and decisions arrive a minute or two later: each batch is stored on 0G every minute, then anchored on chain.</p>
        <p><span className="block font-label text-xs uppercase tracking-widest text-chalk">Not here</span>
          The live camera and the rover&apos;s three lease lights exist only inside the rover; they are on the screen at our booth.</p>
      </section>
    </ArchPage>
  );
}

function Top({ live = false }: { live?: boolean }) {
  return (
    <header className="pb-8">
      <nav className="flex flex-wrap items-center justify-between gap-4 py-4 font-label text-xs uppercase tracking-widest text-chalk-2">
        <Link href="/" className="hover:text-accent">‹ Rover for Hire</Link>
        <Link href="/architecture/" className="hover:text-accent">How it works ›</Link>
      </nav>
      <div className="flex flex-wrap items-end gap-6 pt-6">
        <p className="font-pixel text-5xl leading-none sm:text-7xl">ROVER<span className="text-accent">/</span>HIRE</p>
        <span className={`mb-2 border px-3 py-1 font-label text-sm tracking-[0.3em] ${live ? "border-accent text-accent" : "border-night-rule text-chalk-2"}`}>LIVE</span>
      </div>
      <p className="mt-4 font-label text-sm uppercase tracking-[0.3em] text-chalk-2">A mission as it happens, from public data only</p>
    </header>
  );
}

function Idle({ ep, now }: { ep: Episode | null; now: number }) {
  return (
    <section className="border-y border-night-rule py-8">
      <p className="flex items-center gap-3 font-label text-sm uppercase tracking-widest text-chalk-2">
        <span className="h-3 w-3 bg-night-rule" aria-hidden />No mission running right now
      </p>
      {ep ? (
        <>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed">The last one, <span className="font-pixel text-2xl">{ep.mission || "a mission"}</span>,
            started {ago(now - ep.startedAt)}{ep.ended ? `, with ${ep.ended.decisions} decisions and ${ep.segments.length} batches saved on 0G` : ""}.</p>
          <div className="mt-6 flex flex-wrap gap-3 font-label text-xs uppercase tracking-widest">
            <Link href={`/?episode=${encodeURIComponent(ep.id)}`} className="border border-accent px-4 py-3 text-accent hover:bg-accent hover:text-night">Replay and verify it ›</Link>
            <Link href="/architecture/" className="border border-night-rule px-4 py-3 hover:border-chalk">See how it works ›</Link>
          </div>
        </>
      ) : <p className="mt-4 text-chalk-2">No mission has been recorded yet.</p>}
      <p className="mt-6 text-sm text-chalk-2">This page updates by itself: the next mission appears here the moment it starts on 0G&apos;s chain.</p>
    </section>
  );
}

function Tile({ n, label }: { n: string; label: string }) {
  return (
    <div className="bg-night p-5">
      <p className="font-dots text-4xl leading-none">{n}</p>
      <p className="mt-2 font-label text-xs uppercase tracking-widest text-chalk-2">{label}</p>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-night-rule pb-2">
        <h2 className="font-pixel text-2xl">{title}</h2>
        <p className="font-label text-[0.65rem] uppercase tracking-widest text-chalk-2">{note}</p>
      </div>
      {children}
    </section>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return <p className="border border-dashed border-night-rule p-5 text-sm text-chalk-2">{children}</p>;
}
