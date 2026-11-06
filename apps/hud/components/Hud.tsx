"use client";

import { CHAINS, chainOfTx, HASHSCAN } from "@0xBs/hedera/browser";
import { GALILEO } from "@0xBs/zg/browser";
import { useEffect, useState, type ReactNode } from "react";
import type { Checkpoint, Photo, Snapshot } from "@/lib/types";
import { pauseText, skillLabel } from "../../replay/lib/describe";
import { Pixel, PixelLoader } from "../../replay/components/pixel";
import { Ext, Hash, Status } from "../../replay/components/ui";

// The rover's face (firmware config.h), in words.
const FACES: Record<number, { word: string; tone: string }> = {
  0: { word: "Idle", tone: "text-chalk-2" }, 1: { word: "Ready", tone: "text-chalk" }, 2: { word: "Asking 0G", tone: "text-accent" },
  3: { word: "Moving", tone: "text-move" }, 10: { word: "0G answer refused", tone: "text-pause" }, 11: { word: "Proof failed", tone: "text-bad" },
  12: { word: "Waiting for payment", tone: "text-accent" }, 13: { word: "Stopped", tone: "text-bad" }, 14: { word: "Done", tone: "text-good-night" },
  15: { word: "Battery low", tone: "text-bad" },
};
const MOTOR_LOW_MV = 7000; // the MCU's cutoff
const PAUSED: Record<string, string> = { "402": "waiting for payment", "0G?": "asked 0G again", "!TEE": "proof failed", BAT: "battery low" };

function useSnapshot() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [linked, setLinked] = useState(true);
  useEffect(() => {
    const es = new EventSource("/api/live");
    es.onmessage = (e) => {
      setSnap(JSON.parse(e.data));
      setLinked(true);
    };
    es.onerror = () => setLinked(false);
    return () => es.close();
  }, []);
  return { snap, linked };
}

/** The live camera, about 4 frames a second, double-buffered through object URLs. */
function useFrame(on: boolean) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    let shown: string | null = null;
    (async () => {
      while (live) {
        const r = await fetch("/api/frame", { cache: "no-store" }).catch(() => null);
        if (r?.ok && live) {
          const next = URL.createObjectURL(await r.blob());
          setSrc(next);
          if (shown) URL.revokeObjectURL(shown);
          shown = next;
        }
        await new Promise((res) => setTimeout(res, r?.ok ? 250 : 2000));
      }
    })();
    return () => {
      live = false;
      if (shown) URL.revokeObjectURL(shown);
    };
  }, [on]);
  return on ? src : null;
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const pad = (n: number) => String(n).padStart(2, "0");
const NEW_MS = 3000; // a new row is marked this long

function Panel({ n, label, aside, className = "", children }: { n: string; label: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`flex flex-col bg-night p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="font-label text-xs uppercase tracking-[0.18em] text-chalk-2">[ {n} / {label} ]</p>
        {aside && <div className="font-label text-xs uppercase tracking-[0.12em] text-chalk-2">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A newest-first list, a page at a time; callers key it by mission so a new mission starts on page one. */
function Paged<T>({ items, size, empty, children }: { items: T[]; size: number; empty: ReactNode; children: (rows: T[]) => ReactNode }) {
  const [page, setPage] = useState(0);
  if (!items.length) return <>{empty}</>;
  const pages = Math.ceil(items.length / size);
  const at = Math.min(page, pages - 1);
  return (
    <>
      {children(items.slice(at * size, (at + 1) * size))}
      {pages > 1 && (
        <nav className="mt-auto flex items-center justify-between gap-3 pt-3 font-label text-[0.65rem] uppercase tracking-[0.14em] text-chalk-2">
          <PageButton on={at > 0} go={() => setPage((p) => Math.max(Math.min(p, pages - 1) - 1, 0))}>‹ Newer</PageButton>
          <span>{at * size + 1}–{Math.min(items.length, (at + 1) * size)} of {items.length}</span>
          <PageButton on={at < pages - 1} go={() => setPage((p) => Math.min(p + 1, pages - 1))}>Older ›</PageButton>
        </nav>
      )}
    </>
  );
}

function PageButton({ on, go, children }: { on: boolean; go: () => void; children: ReactNode }) {
  return (
    <button type="button" disabled={!on} onClick={go}
      className="border border-night-rule px-2.5 py-1 uppercase enabled:hover:border-accent enabled:hover:text-chalk disabled:opacity-30">
      {children}
    </button>
  );
}

function Reading({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="font-label text-[0.65rem] uppercase tracking-[0.16em] text-chalk-2">{label}</p>
      <p className={`font-dots text-2xl leading-tight ${tone}`}>{value}</p>
    </div>
  );
}

function Lease({ name, on, what }: { name: string; on: boolean | undefined; what: string }) {
  return (
    <div className={`border-2 p-3 ${on ? "border-good-night bg-good-night/10" : "border-night-rule"}`}>
      <div className="flex items-center justify-between">
        <p className="font-label text-xs uppercase tracking-[0.16em]">{name}</p>
        <Pixel name={on ? "check" : "cross"} size={16} grid={false} className={on ? "text-good-night" : "text-chalk-2"} label={on ? "holds" : "off"} />
      </div>
      <p className={`mt-2 font-pixel text-xl ${on ? "text-good-night" : "text-chalk-2"}`}>{on ? "Holds" : "Off"}</p>
      <p className="mt-1 text-xs text-chalk-2">{what}</p>
    </div>
  );
}

function Decision({ r }: { r: Checkpoint | undefined }) {
  if (!r) return <p className="text-chalk-2">No checkpoint yet.</p>;
  const paused = !!r.safe_stop;
  return (
    <div>
      <p className={`font-pixel text-3xl leading-tight ${paused ? "text-pause" : r.photo ? "text-photo" : "text-chalk"}`}>
        {paused ? (r.safe_stop === "402" ? "Waiting for payment" : "Asked 0G again") : r.photo ? `Took photo ${r.photo}` : skillLabel(r.skill ?? undefined)}
      </p>
      {paused ? <p className="mt-3 leading-relaxed text-chalk">{pauseText({ reason: r.safe_stop!, detail: r.stop_detail ?? undefined })}</p> : (
        <>
          {r.see && <p className="mt-3 leading-relaxed text-chalk">“{r.see}”</p>}
          {r.reason && <p className="mt-1 leading-relaxed text-chalk-2">because “{r.reason}”</p>}
        </>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-chalk-2">
        <span>step {r.seq + 1}</span>
        {r.latency_ms != null && <span>0G answered in {(r.latency_ms / 1000).toFixed(1)} s</span>}
        {r.request_id && <span>request <Hash value={r.request_id} n={4} /></span>}
        {!paused && <Status ok={r.verified} night>{r.verified ? "TEE signature verified" : "TEE signature failed"}</Status>}
      </div>
    </div>
  );
}

// The mission's quote keeps photo n of one mission from showing a cached photo n of the last one; a root that 0G
// Storage cannot serve yet (just uploaded) is asked again a few seconds later.
function PhotoCard({ p, quote, className }: { p: Photo; quote: string; className: string }) {
  const [tries, setTries] = useState(0);
  const q = new URLSearchParams({ q: quote, ...(p.root ? { root: p.root } : {}), ...(tries ? { t: String(tries) } : {}) });
  return (
    <figure className={`border border-night-rule ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the HUD from 0G Storage or the rover */}
      <img src={`/api/photo/${p.n}?${q}`} alt={`Photo ${p.n}`} className="aspect-[4/3] w-full object-cover"
        onError={() => tries < 10 && setTimeout(() => setTries((t) => t + 1), 3000)} />
      <figcaption className="flex items-center justify-between px-2 py-1.5 font-label text-[0.65rem] uppercase tracking-[0.14em] text-chalk-2">
        photo {pad(p.n)}{p.root ? <span className="text-good-night">on 0G</span> : <span>storing…</span>}
      </figcaption>
    </figure>
  );
}

export function Hud() {
  const { snap, linked } = useSnapshot();
  const online = snap?.rover === "online";
  const frame = useFrame(online);
  const now = useNow();
  if (!snap) return <div className="grid min-h-screen place-items-center"><PixelLoader label="Connecting to the rover" /></div>;

  const m = snap.mission;
  const mcu = snap.mcu;
  const face = mcu ? FACES[mcu.face] ?? { word: `face ${mcu.face}`, tone: "text-chalk" } : null;
  const last = snap.records[0];
  const moveUsd = snap.prices ? Number(snap.prices.move) : 0;
  const photoUsd = snap.prices ? Number(snap.prices.photo) : 0;
  const spent = snap.movesPaid * moveUsd + snap.photosPaid * photoUsd;
  const fresh = (seen: number) => (seen > 0 && snap.at - seen < NEW_MS ? "hud-arrive" : "");
  const next = snap.live && m && snap.photos.length < m.photos_wanted ? (snap.photos[0]?.n ?? 0) + 1 : null;
  const slots: (Photo | { n: number; next: true })[] = [...(next ? [{ n: next, next: true as const }] : []), ...snap.photos];
  const quote = m?.quote_id;

  return (
    <main className="min-h-screen">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-night-rule px-4 py-3 sm:px-6">
        <p className="flex items-center gap-2.5 font-pixel text-xl">
          <Pixel name="rover" size={22} grid={false} />ROVER<span className="text-accent">/</span>HIRE
          <span className="ml-2 border border-chalk/40 px-2 py-0.5 font-label text-[0.65rem] tracking-[0.16em]">LIVE HUD</span>
        </p>
        <p className="flex items-center gap-2 font-label text-xs uppercase tracking-[0.14em]">
          <span className={`h-2.5 w-2.5 ${online ? "bg-good-night" : "bg-bad"} ${online && snap.live ? "animate-pulse" : ""}`} aria-hidden />
          {!linked ? "HUD server unreachable" : online ? (snap.live ? "Rover on a mission" : "Rover idle") : "Rover offline"}
        </p>
        {m && (
          <p className="min-w-0 flex-1 truncate text-sm text-chalk-2">
            <span className="font-pixel text-base text-chalk">{m.mission}</span> · quote <Hash value={m.quote_id} />
            {snap.live ? m.started_ms && <> · <span className="text-chalk">{clock(now - m.started_ms)}</span></>
              : <span className="ml-3 border border-chalk/40 px-2 py-0.5 font-label text-[0.65rem] uppercase tracking-[0.16em]">ended</span>}
          </p>
        )}
      </header>
      {m && !snap.live && (
        <p className="border-b border-night-rule bg-night-2 px-4 py-2 text-sm text-chalk-2 sm:px-6">
          The rover is {online ? "idle" : "offline"}, so every panel below shows its <span className="text-chalk">last mission</span>, as it ended.
          The HUD moves to the next mission the moment it starts.
        </p>
      )}

      <div className="grid gap-px bg-night-rule lg:grid-cols-12">
        <Panel n="01" label="Camera" className="lg:col-span-7 lg:row-span-3"
          aside={face && <span className={face.tone}>Face: {face.word}</span>}>
          <div className="relative aspect-[4/3] w-full overflow-hidden border border-night-rule bg-night-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a live object URL, not an optimisable asset */}
            {frame ? <img src={frame} alt="The rover's camera, live" className="h-full w-full object-cover" />
              : <div className="grid h-full place-items-center text-chalk-2">{online ? <PixelLoader label="Waiting for a frame" /> : "No camera: the rover is offline"}</div>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Reading label="Sonar ahead" value={mcu ? (mcu.sonar_mm < 0 ? "no echo" : `${Math.round(mcu.sonar_mm / 10)} cm`) : "—"} />
            <Reading label="Heading" value={mcu ? `${(((Math.round(mcu.yaw_cdeg / 100) % 360) + 360) % 360)}°` : "—"} />
            <Reading label="Motor battery" value={mcu ? `${(mcu.batt_mv / 1000).toFixed(2)} V` : "—"}
              tone={mcu && mcu.batt_mv < MOTOR_LOW_MV ? "text-bad" : ""} />
            <Reading label="Motors" value={mcu ? mcu.mode_name : "—"} />
          </div>
        </Panel>

        <Panel n="02" label="0G decision" className="lg:col-span-5" aside={snap.checkpoints ? `${snap.checkpoints} checkpoints` : undefined}>
          <Decision r={last} />
        </Panel>

        <Panel n="03" label="Leases" className="lg:col-span-5"
          aside={snap.live && snap.leases ? `moves used ${snap.leases.used} of ${snap.leases.paid} paid` : "no mission running"}>
          <div className="grid grid-cols-3 gap-3">
            <Lease name="Brain" on={snap.live && snap.leases?.brain} what="0G answered with a move" />
            <Lease name="Proof" on={snap.live && snap.leases?.proof} what="its TEE signature checks out" />
            <Lease name="Money" on={snap.live && snap.leases?.money_ok} what="the move is paid on Hedera" />
          </div>
          <p className="mt-3 text-xs text-chalk-2">
            The rover moves only while all three hold.{!snap.live && " Between missions none is held."}
          </p>
        </Panel>

        <Panel n="06" label="Checkpoints" className="lg:col-span-5" aside={snap.checkpoints ? `${snap.checkpoints} in all` : undefined}>
          <Paged key={quote} items={snap.records} size={8} empty={<p className="text-sm text-chalk-2">No checkpoint yet.</p>}>
            {(rows) => (
              <ol className="divide-y divide-night-rule">
                {rows.map((r) => (
                  <li key={r.seq} className={`grid grid-cols-[3rem_1fr_auto] items-center gap-3 py-2 text-sm ${fresh(r.seen)}`}>
                    <span className="text-chalk-2">{r.seq + 1}</span>
                    <span className={`min-w-0 truncate ${r.safe_stop ? "text-pause" : r.photo ? "text-photo" : ""}`}>
                      {r.safe_stop ? PAUSED[r.safe_stop] ?? `paused (${r.safe_stop})` : r.photo ? `photo ${r.photo}` : skillLabel(r.skill ?? undefined).toLowerCase()}
                    </span>
                    <span className="text-chalk-2">{r.latency_ms != null ? `${(r.latency_ms / 1000).toFixed(1)} s` : ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </Paged>
        </Panel>

        <Panel n="04" label={`Paid on ${(chainOfTx(snap.payments[0]?.tx ?? "") ?? CHAINS.hedera).label.replace(/ (testnet|devnet)$/, "")}`} className="lg:col-span-4"
          aside={snap.prices ? `${spent.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} USDC` : undefined}>
          {snap.prices && (
            <p className="mb-3 text-sm text-chalk-2">{snap.movesPaid} moves × {snap.prices.move} + {snap.photosPaid} photos × {snap.prices.photo} USDC</p>
          )}
          <Paged key={quote} items={snap.payments} size={7} empty={<p className="text-sm text-chalk-2">No payments yet.</p>}>
            {(rows) => (
              <ul className="divide-y divide-night-rule">
                {rows.map((p) => (
                  <li key={p.tx} className={`flex items-center justify-between gap-3 py-2 text-sm ${fresh(p.seen)}`}>
                    <span className="flex items-center gap-2.5">
                      <Pixel name={p.kind === "photo" ? "camera" : "coin"} size={14} grid={false} className={p.kind === "photo" ? "text-photo" : "text-move"} />
                      {p.kind} {p.n}
                    </span>
                    <Ext href={p.link}>{(chainOfTx(p.tx) ?? CHAINS.hedera).explorer}</Ext>
                  </li>
                ))}
              </ul>
            )}
          </Paged>
        </Panel>

        <Panel n="05" label="0G Storage" className="lg:col-span-4" aside={`${snap.segments.length} segments`}>
          {snap.ended && <p className="mb-3 text-sm"><Ext href={`${GALILEO.explorer}/tx/${snap.ended}`}>Episode closed on Galileo</Ext></p>}
          <Paged key={quote} items={snap.segments} size={7}
            empty={<p className="text-sm text-chalk-2">The first segment is stored about a minute in.</p>}>
            {(rows) => (
              <ul className="divide-y divide-night-rule">
                {rows.map((s) => (
                  <li key={s.index} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm ${fresh(s.seen)}`}>
                    <span>steps {s.first_seq + 1}–{s.last_seq + 1} · {s.root ? <Hash value={s.root} n={4} /> : <span className="text-chalk-2">uploading…</span>}</span>
                    {s.anchor ? <Ext href={`${GALILEO.explorer}/tx/${s.anchor}`}>anchored</Ext> : s.root && <span className="text-chalk-2">anchoring…</span>}
                  </li>
                ))}
              </ul>
            )}
          </Paged>
        </Panel>

        <Panel n="07" label="Hedera consensus" className="lg:col-span-4" aside={snap.messages.length ? `${snap.messages.length} messages` : undefined}>
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-chalk-2">
            {snap.topics.map((t) => (
              <Ext key={t.topic} href={`${HASHSCAN}/topic/${t.topic}`}>{t.name}{t.seq != null && ` · ${t.seq}`}</Ext>
            ))}
          </div>
          <Paged key={quote} items={snap.messages} size={7} empty={<p className="text-sm text-chalk-2">No messages for this mission yet.</p>}>
            {(rows) => (
              <ul className="divide-y divide-night-rule">
                {rows.map((x) => (
                  <li key={`${x.topic}:${x.seq}`} className={`grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 py-2 text-sm ${fresh(x.seen)}`}>
                    <span className="font-label text-[0.65rem] uppercase tracking-[0.12em] text-chalk-2">{x.role}</span>
                    <span className="min-w-0 truncate" title={x.text}>{x.text}</span>
                    <Ext href={x.link}>#{x.seq}</Ext>
                  </li>
                ))}
              </ul>
            )}
          </Paged>
        </Panel>

        <Panel n="08" label="Photos delivered" className="lg:col-span-12" aside={m ? `${snap.photos.length} of ${m.photos_wanted}` : undefined}>
          <Paged key={quote} items={slots} size={6} empty={<p className="text-sm text-chalk-2">No photos yet.</p>}>
            {(rows) => (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {rows.map((p) => "next" in p ? (
                  <figure key="next" className="border border-dashed border-night-rule">
                    <div className="grid aspect-[4/3] place-items-center bg-night-2 text-xs text-chalk-2">waiting</div>
                    <figcaption className="px-2 py-1.5 font-label text-[0.65rem] uppercase tracking-[0.14em] text-chalk-2">photo {pad(p.n)} · next</figcaption>
                  </figure>
                ) : <PhotoCard key={`${p.n}-${p.root ?? ""}`} p={p} quote={quote ?? ""} className={fresh(p.seen)} />)}
              </div>
            )}
          </Paged>
        </Panel>
      </div>
    </main>
  );
}
// 2026-11-06T19:16:00
// 2026-11-06T22:43:08


// Lease lights: turn red immediately when any lease is false.
// WebSocket auto-reconnects on close (the rover service restarts on the board).
function leaseColour(ok: boolean) { return ok ? "bg-green-400" : "bg-red-500"; }

// Payment ticker shows the last 5 payments with HashScan links.
function PaymentRow({ p }: { p: Payment }) {
  return (
    <a href={p.hashscanUrl} target="_blank" className="text-xs font-mono text-blue-400">
      {p.amount} USDC ↗
    </a>
  );
}
