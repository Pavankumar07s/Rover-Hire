"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { PIXELS, type PixelName } from "@/lib/pixels";
import type { Box, Flow, Spec, Token, Tone } from "@/lib/arch";
import { LAST_RUN } from "@/lib/config";

// Architecture diagrams: boxes on a 1600×900 board, and tokens (coins, signed answers, frames, records, photos) that
// travel the paths one step at a time, stepped at 12 fps like the hero scene so motion stays pixel-snapped. "still"
// draws every path at once with arrows and step numbers, for print.
const FPS = 12;
const CELL = 4;
const C = { chalk: "#f2ede3", dim: "#a39d90", rule: "#2b2b2b", panel: "#151515", night: "#0a0a0a", accent: "#ff6a13",
  move: "#3987e5", photo: "#d55181", good: "#2fbf4f", violet: "#a66cff", sun: "#e8c547" };
// Hedera keeps its own black and white; 0G is violet, a colour no token uses.
const TONE: Record<Tone, { ink: string; fill: string }> = {
  hedera: { ink: C.chalk, fill: "rgba(242,237,227,0.035)" },
  "0g": { ink: C.violet, fill: "rgba(166,108,255,0.07)" },
  // Base and Solana have no mark on the board, only their colour and name.
  base: { ink: "#4f86ff", fill: "rgba(79,134,255,0.07)" },
  solana: { ink: "#19d3c5", fill: "rgba(25,211,197,0.07)" },
};
const TONE_NAME: Record<Tone, string> = { hedera: "Hedera", "0g": "0G", base: "Base", solana: "Solana" };
const TOKEN_COLOR: Record<Token, string> = { msg: C.chalk, coin: C.accent, lock: C.good, frame: C.move, block: C.chalk, photo: C.photo,
  check: C.good, reading: C.sun };
const SPRITES: Record<Token, readonly string[]> = {
  msg: ["###", "###", "###"],
  coin: [".###.", "##*##", "#*#*#", "##*##", ".###."],
  lock: [".###.", ".#.#.", "#####", "##*##", "#####"],
  frame: ["#####", "#...#", "#.#.#", "#...#", "#####"],
  block: ["######", "#*##*#", "######"],
  photo: ["#####", "#.###", "##.##", "#####", "#####"],
  check: [".....", "....#", "...#.", "#.#..", ".#..."],
  reading: ["..#..", ".#*#.", ".#*#.", "#***#", ".###."],
};
const OFF = ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"];

function sprite(rows: readonly string[], x: number, y: number, cell: number, ink: string, star = C.chalk) {
  return rows.flatMap((r, j) => [...r].map((c, i) => (c === "." ? null
    : <rect key={`${i}-${j}`} x={x + i * cell} y={y + j * cell} width={cell} height={cell} fill={c === "*" ? star : ink} />)));
}

function Icon({ name, x, y, size, color }: { name: PixelName; x: number; y: number; size: number; color: string }) {
  return <g>{sprite(PIXELS[name], x, y, size / 9, color, C.accent)}</g>;
}

const tonesOf = (spec: Spec) => [...new Set([...spec.bands.flatMap((b) => (b.tone ? [b.tone] : [])), ...spec.boxes.flatMap((b) => b.chains ?? [])])];
const tokensOf = (spec: Spec) => [...new Set(spec.flows.map((f) => f.token))];
const within = (t: number, [a, b]: readonly [number, number]) => t >= a && t <= b;
const inside = (b: Box, band: { x: number; y: number; w: number; h: number }) =>
  b.x >= band.x && b.y >= band.y && b.x + b.w <= band.x + band.w && b.y + b.h <= band.y + band.h;

function along(pts: readonly (readonly [number, number])[], p: number, snap = true): [number, number] {
  const seg = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]));
  let d = Math.max(0, Math.min(1, p)) * seg.reduce((a, b) => a + b, 0);
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i]! || i === seg.length - 1) {
      const f = seg[i]! ? Math.min(1, d / seg[i]!) : 0;
      const [a, b] = [pts[i]!, pts[i + 1]!];
      const [x, y] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      return snap ? [Math.round(x / CELL) * CELL, Math.round(y / CELL) * CELL] : [x, y];
    }
    d -= seg[i]!;
  }
  return [pts[0]![0], pts[0]![1]];
}

/** Where each step's number sits: on its first path, or on its first box when it has no path. */
function badgeSpots(spec: Spec) {
  return spec.steps.map((s) => {
    const f = spec.flows.find((x) => x.at[0] >= s.at[0] && x.at[0] < s.at[1]);
    if (f) return along(f.pts, 0.5, false);
    const b = spec.boxes.find((x) => x.id === s.focus[0])!;
    return [b.x + b.w - 16, b.y + b.h - 16] as [number, number];
  });
}

function Markers() {
  return (
    <defs>
      {(Object.keys(TOKEN_COLOR) as Token[]).map((k) => (
        <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12"
          markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill={TOKEN_COLOR[k]} />
        </marker>
      ))}
    </defs>
  );
}

function FlowLine({ f, t, still }: { f: Flow; t: number; still: boolean }) {
  const on = still || within(t, f.at);
  const d = f.pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
  return <path d={d} fill="none" stroke={on ? TOKEN_COLOR[f.token] : C.rule} strokeWidth={on ? 3 : 2} strokeLinecap="square"
    strokeDasharray={on ? undefined : "2 6"} opacity={on ? (still ? 0.6 : 0.8) : 1} markerEnd={on ? `url(#arrow-${f.token})` : undefined} />;
}

function FlowToken({ f, t }: { f: Flow; t: number }) {
  if (!within(t, f.at)) return null;
  const [x, y] = along(f.pts, (t - f.at[0]) / (f.at[1] - f.at[0]));
  const rows = SPRITES[f.token];
  const w = rows[0]!.length * CELL, h = rows.length * CELL;
  return (
    <g>
      <rect x={x - w / 2 - 3} y={y - h / 2 - 3} width={w + 6} height={h + 6} fill={C.night} />
      {sprite(rows, x - w / 2, y - h / 2, CELL, TOKEN_COLOR[f.token], f.token === "coin" ? C.night : C.chalk)}
      {f.label && <text x={x + w / 2 + 8} y={y + 5} className="font-label" fontSize={13} fill={TOKEN_COLOR[f.token]}>{f.label}</text>}
    </g>
  );
}

function Badge({ n, at, current }: { n: number; at: readonly [number, number]; current: boolean }) {
  return (
    <g>
      <rect x={at[0] - 15} y={at[1] - 15} width={30} height={30} fill={current ? C.accent : C.night} stroke={C.accent} strokeWidth={2} />
      <text x={at[0]} y={at[1] + 7} textAnchor="middle" className="font-pixel" fontSize={20} fill={current ? C.night : C.accent}>{n}</text>
    </g>
  );
}

function Lights({ box, spec, t, still }: { box: Box; spec: Spec; t: number; still: boolean }) {
  const names = (["brain", "proof", "money"] as const).filter((n) => spec.lights?.[n]);
  const w = (box.w - 40 - (names.length - 1) * 10) / names.length;
  return (
    <g>
      {names.map((n, i) => {
        const on = still || within(t, spec.lights![n]!);
        const x = box.x + 20 + i * (w + 10), y = box.y + box.h - (box.track ? 116 : 54); // above the track when both
        return (
          <g key={n}>
            <rect x={x} y={y} width={w} height={36} fill={on ? "rgba(47,191,79,0.14)" : C.night} stroke={on ? C.good : C.rule} strokeWidth={2} />
            <text x={x + 10} y={y + 23} className="font-label" fontSize={13} fill={on ? C.good : C.dim}>{n.toUpperCase()}</text>
            <g>{sprite(on ? SPRITES.check : OFF, x + w - 28, y + 9, 3.6, on ? C.good : C.dim)}</g>
          </g>
        );
      })}
    </g>
  );
}

function Track({ box, spec, t }: { box: Box; spec: Spec; t: number }) {
  const [a, b] = spec.drive!;
  const y = box.y + box.h - 58, x0 = box.x + 24, x1 = box.x + box.w - 64;
  const p = t < a ? 0 : t > b ? 1 : (t - a) / (b - a);
  const x = Math.round((x0 + (x1 - x0) * p) / CELL) * CELL;
  const moving = t >= a && t <= b;
  return (
    <g>
      <line x1={x0} y1={y + 40} x2={box.x + box.w - 20} y2={y + 40} stroke={C.rule} strokeWidth={2} strokeDasharray="4 6" />
      <Icon name="rover" x={x} y={y} size={40} color={moving ? C.move : C.chalk} />
      {moving && <text x={box.x + box.w - 20} y={y - 8} textAnchor="end" className="font-label" fontSize={13} fill={C.move}>MOVING</text>}
    </g>
  );
}

/** One chip per chain, in that chain's colour, under the box's lines. */
function Chains({ box }: { box: Box }) {
  let x = box.x + 18;
  const y = box.y + 90 + ((box.lines?.length ?? 1) - 1) * 22 + 14;
  return (
    <g>
      {box.chains!.map((c) => {
        const name = TONE_NAME[c].toUpperCase(), w = name.length * 8 + 14, at = x;
        x += w + 6;
        return (
          <g key={c}>
            <rect x={at} y={y} width={w} height={22} fill={TONE[c].fill} stroke={TONE[c].ink} strokeWidth={2} />
            <text x={at + 7} y={y + 15} className="font-label" fontSize={10} fill={TONE[c].ink}>{name}</text>
          </g>
        );
      })}
    </g>
  );
}

function BoxView({ box, spec, t, lit, tone, still }: { box: Box; spec: Spec; t: number; lit: boolean; tone?: Tone; still: boolean }) {
  const ink = tone ? TONE[tone].ink : C.chalk;
  return (
    <g>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={C.panel} stroke={lit || tone ? ink : C.rule}
        strokeOpacity={lit ? 1 : tone ? 0.45 : 1} strokeWidth={lit ? 3 : 2} />
      {box.logo && <image href={`/brand/${box.logo === "hedera" ? "hedera-mark" : "0g"}.png`} x={box.x + box.w - (box.logo === "hedera" ? 46 : 70)}
        y={box.y + 14} height={32} width={box.logo === "hedera" ? 32 : 66} preserveAspectRatio="xMaxYMin meet" />}
      {box.icon && !box.logo && <Icon name={box.icon} x={box.x + box.w - 46} y={box.y + 14} size={32} color={lit || still ? C.chalk : C.dim} />}
      <text x={box.x + 18} y={box.y + 28} className="font-label" fontSize={12} letterSpacing={1.5} fill={tone ? ink : C.dim}>{box.tag.toUpperCase()}</text>
      <text x={box.x + 18} y={box.y + 60} className="font-pixel" fontSize={25} fill={C.chalk}>{box.title}</text>
      {box.lines?.map((l, i) => (
        <text key={i} x={box.x + 18} y={box.y + 90 + i * 22} className="font-mono" fontSize={16} fill={lit || still ? C.chalk : C.dim}>{l}</text>
      ))}
      {box.chains && <Chains box={box} />}
      {box.lights && <Lights box={box} spec={spec} t={t} still={still} />}
      {box.track && spec.drive && <Track box={box} spec={spec} t={still ? 0 : t} />}
    </g>
  );
}

/** The board itself. `t` is ms in the loop; `still` draws every path, arrow and step number at once. */
export function Board({ spec, t, still = false, className = "h-auto w-full" }: { spec: Spec; t: number; still?: boolean; className?: string }) {
  const step = Math.max(0, spec.steps.findIndex((s) => within(t, s.at)));
  const focus = new Set(still ? [] : spec.steps[step]!.focus);
  const spots = badgeSpots(spec);
  const toneOf = (b: Box) => spec.bands.find((band) => band.tone && inside(b, band))?.tone;
  return (
    <svg viewBox="0 0 1600 900" className={className} role="img" aria-label={spec.label}>
      <Markers />
      {spec.bands.map((b) => {
        const tone = b.tone ? TONE[b.tone] : null;
        const logoW = b.tone === "hedera" ? 104 : b.tone === "0g" ? 60 : 0;
        const chipX = b.x + 14 + (logoW ? logoW + 12 : 0), chipW = b.label.length * 11 + 22;
        return (
          <g key={b.label}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={tone ? tone.fill : "none"} stroke={tone ? tone.ink : C.rule}
              strokeOpacity={tone ? 0.55 : 1} strokeWidth={2} strokeDasharray={tone ? undefined : "1 7"} />
            {logoW > 0 && <rect x={b.x + 6} y={b.y - 16} width={logoW + 16} height={32} fill={C.night} />}
            {logoW > 0 && <image href={`/brand/${b.tone === "hedera" ? "hedera" : "0g"}.png`} x={b.x + 14} y={b.y - 14} height={28} width={logoW}
              preserveAspectRatio="xMinYMid meet" />}
            <rect x={chipX} y={b.y - 12} width={chipW} height={24} fill={tone ? tone.ink : C.night} />
            <text x={chipX + 11} y={b.y + 5} className="font-label" fontSize={13} letterSpacing={2} fill={tone ? C.night : C.dim}>{b.label}</text>
          </g>
        );
      })}
      {spec.flows.map((f, i) => <FlowLine key={i} f={f} t={t} still={still} />)}
      {spec.boxes.map((b) => <BoxView key={b.id} box={b} spec={spec} t={t} lit={focus.has(b.id)} tone={toneOf(b)} still={still} />)}
      {!still && spec.flows.map((f, i) => <FlowToken key={i} f={f} t={t} />)}
      {spots.map((at, i) => (still || i === step) && <Badge key={i} n={i + 1} at={at} current={!still} />)}
    </svg>
  );
}

const REDUCE = "(prefers-reduced-motion: reduce)";

function useReducedMotion() {
  return useSyncExternalStore((cb) => {
    const m = window.matchMedia(REDUCE);
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  }, () => window.matchMedia(REDUCE).matches, () => false);
}

/** The loop clock, at 12 fps. With ?capture in the URL it stands still and a recorder sets it (window.__archSetT). */
function useLoop(spec: Spec) {
  const reduce = useReducedMotion();
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const capture = useSyncExternalStore(() => () => {}, () => new URLSearchParams(window.location.search).has("capture"), () => false);
  const live = playing && !reduce && !capture;
  useEffect(() => {
    if (!capture) return;
    (window as unknown as { __archSetT?: (ms: number) => void }).__archSetT = (ms) => setT(ms % spec.T);
  }, [capture, spec.T]);
  useEffect(() => {
    if (!live) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      setT((v) => (v + dt) % spec.T);
    }, 1000 / FPS);
    return () => clearInterval(id);
  }, [live, spec.T]);
  const step = Math.max(0, spec.steps.findIndex((s) => within(t, s.at)));
  const go = (i: number) => setT(spec.steps[(i + spec.steps.length) % spec.steps.length]!.at[0] + 1);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      if (e.key === "ArrowRight") go(step + 1);
      if (e.key === "ArrowLeft") go(step - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return { t, step, go, playing, setPlaying, reduce };
}

function Btn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className="border border-night-rule px-3 py-1.5 hover:border-accent hover:text-accent">{children}</button>;
}

/** The web page version: caption with controls, the board, the legend and the clickable step list. */
export function ArchDiagram({ spec, present }: { spec: Spec; present: string }) {
  const { t, step, go, playing, setPlaying, reduce } = useLoop(spec);
  const cur = spec.steps[step]!;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 border-y border-night-rule py-3">
        <p className="font-label text-sm tracking-widest text-accent">STEP {step + 1} / {spec.steps.length}</p>
        <p className="min-w-0 flex-1 font-pixel text-2xl">{cur.title}</p>
        <div className="flex gap-2 font-label text-xs uppercase tracking-widest">
          <Btn onClick={() => go(step - 1)}>‹ Back</Btn>
          {!reduce && <Btn onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</Btn>}
          <Btn onClick={() => go(step + 1)}>Next ›</Btn>
          <Link href={present} className="border border-night-rule px-3 py-1.5 hover:border-accent hover:text-accent">Full screen</Link>
        </div>
      </div>
      <p className="min-h-[3.5rem] py-3 text-lg leading-relaxed text-chalk-2">{cur.text}</p>
      <Board spec={spec} t={t} />
      <Legend tones={tonesOf(spec)} tokens={tokensOf(spec)} />
      <Steps spec={spec} step={step} go={go} />
    </div>
  );
}

function Steps({ spec, step, go }: { spec: Spec; step: number; go: (i: number) => void }) {
  return (
    <ol className="mt-10 grid gap-px bg-night-rule sm:grid-cols-2">
      {spec.steps.map((s, i) => (
        <li key={s.title}>
          <button type="button" onClick={() => go(i)} className={`h-full w-full p-5 text-left ${i === step ? "bg-night-2" : "bg-night"} hover:bg-night-2`}>
            <span className={`font-label text-xs tracking-widest ${i === step ? "text-accent" : "text-chalk-2"}`}>STEP {i + 1}</span>
            <span className="mt-1 block font-pixel text-xl">{s.title}</span>
            <span className="mt-1 block text-sm leading-relaxed text-chalk-2">{s.text}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function Legend({ className = "mt-5", tones = ["hedera", "0g"], tokens }: { className?: string; tones?: Tone[]; tokens?: Token[] }) {
  const items = ([["coin", "USDC payment"], ["lock", "signed answer"], ["frame", "camera frame"], ["block", "saved record"],
    ["photo", "paid photo"], ["reading", "signed reading"], ["msg", "message"], ["check", "checked"]] as [Token, string][])
    .filter(([k]) => !tokens || tokens.includes(k));
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 font-label text-xs uppercase tracking-widest text-chalk-2 ${className}`}>
      {items.map(([k, label]) => (
        <span key={k} className="flex items-center gap-2">
          <svg viewBox="0 0 24 20" width={24} height={20} aria-hidden shapeRendering="crispEdges">{sprite(SPRITES[k], 2, 2, 3.2, TOKEN_COLOR[k], k === "coin" ? C.night : C.chalk)}</svg>
          {label}
        </span>
      ))}
      {tones.map((t) => (
        <span key={t} className="flex items-center gap-2">
          <span className="inline-block h-3 w-5 border-2" style={{ borderColor: TONE[t].ink }} />{TONE_NAME[t]}
        </span>
      ))}
    </div>
  );
}

function Logos({ logos }: { logos: Tone[] }) {
  return (
    <div className="flex items-center gap-6">
      {logos.map((l, i) => (
        <span key={l} className="flex items-center gap-6">
          {i > 0 && <span className="font-pixel text-3xl text-accent">×</span>}
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, a small local mark */}
          <img src={`/brand/${l}.png`} alt={l === "hedera" ? "Hedera" : "0G"} className={l === "hedera" ? "h-9" : "h-11"} />
        </span>
      ))}
    </div>
  );
}

/** The poster's header: the ROVER/HIRE mark, the page's subject and the "built on" logos; tabs between the diagrams. */
export function ArchHeader({ subject, logos, current }: { subject: string; logos: Tone[]; current: string }) {
  const tabs = [["/architecture/", "Whole system"], ["/architecture/hedera/", "Hedera"], ["/architecture/0g/", "0G"],
    ["/architecture/station/", "Station-A"], ["/architecture/multichain/", "Any chain"]] as const;
  return (
    <header className="pb-8">
      <nav className="flex flex-wrap items-center justify-between gap-4 py-4 font-label text-xs uppercase tracking-widest text-chalk-2">
        <Link href="/" className="hover:text-accent">‹ Rover for Hire</Link>
        <div className="flex flex-wrap gap-1">
          {tabs.map(([href, label]) => (
            <Link key={href} href={href} className={`border px-3 py-1.5 ${current === href ? "border-accent text-accent" : "border-night-rule hover:text-chalk"}`}>{label}</Link>
          ))}
        </div>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-6 pt-6">
        <div>
          <p className="font-pixel text-5xl leading-none sm:text-7xl">ROVER<span className="text-accent">/</span>HIRE</p>
          <p className="mt-4 font-label text-sm uppercase tracking-[0.3em] text-chalk-2">{subject}</p>
        </div>
        <Logos logos={logos} />
      </div>
    </header>
  );
}

const DOTS = { backgroundImage: "radial-gradient(rgba(242,237,227,0.09) 1px, transparent 1.6px)", backgroundSize: "14px 14px" };

/** The night page with the poster's faint dot grid. */
export function ArchPage({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-night text-chalk" style={DOTS}>
      <div className="mx-auto max-w-[1600px] px-4 pb-16 sm:px-8">{children}</div>
    </main>
  );
}

/** The last real run (LAST_RUN), so every claim on the diagram points at something that happened. */
export function RunStrip({ className = "mb-8" }: { className?: string }) {
  if (!LAST_RUN) return null;
  return (
    <div className={`flex flex-wrap items-baseline gap-x-8 gap-y-2 ${className}`}>
      <p className="font-label text-xs uppercase tracking-widest text-chalk-2">Last run · {LAST_RUN.date}</p>
      {LAST_RUN.facts.map(([n, l]) => (
        <p key={l} className="flex items-baseline gap-2"><span className="font-dots text-3xl text-chalk">{n}</span>
          <span className="font-label text-xs uppercase tracking-widest text-chalk-2">{l}</span></p>
      ))}
    </div>
  );
}

/** Full screen for a booth monitor (and the GIF recorder): a slim header with the step caption, the board fitted to
    what is left of the screen, the legend at the foot. */
export function ArchPresent({ spec, subject, logos }: { spec: Spec; subject: string; logos: Tone[] }) {
  const { t, step } = useLoop(spec);
  const cur = spec.steps[step]!;
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-night px-8 text-chalk" style={DOTS}>
      <div className="flex items-center gap-8 border-b border-night-rule py-4">
        <div className="shrink-0">
          <p className="font-pixel text-3xl leading-none">ROVER<span className="text-accent">/</span>HIRE</p>
          <p className="mt-2 font-label text-[0.65rem] uppercase tracking-[0.25em] text-chalk-2">{subject}</p>
        </div>
        <div className="min-w-0 flex-1 border-l border-night-rule pl-8">
          <p className="font-label text-xs tracking-widest text-accent">STEP {step + 1} / {spec.steps.length}</p>
          <p className="mt-1 font-pixel text-2xl leading-tight">{cur.title}</p>
          <p className="mt-1 line-clamp-2 text-base leading-snug text-chalk-2">{cur.text}</p>
        </div>
        <Logos logos={logos} />
      </div>
      <div className="min-h-0 flex-1 py-3"><Board spec={spec} t={t} className="h-full w-full" /></div>
      <Legend className="justify-center border-t border-night-rule py-3" tones={tonesOf(spec)} tokens={tokensOf(spec)} />
    </main>
  );
}

/** One printed page (1920×1080): the board with every path, arrow and step number, and the numbered steps beside it. */
export function ArchSlide({ spec, subject, logos }: { spec: Spec; subject: string; logos: Tone[] }) {
  return (
    <section className="flex h-[1080px] w-[1920px] flex-col bg-night px-14 py-10 text-chalk" style={DOTS}>
      <div className="flex items-end justify-between border-b border-night-rule pb-6">
        <div>
          <p className="font-pixel text-5xl leading-none">ROVER<span className="text-accent">/</span>HIRE</p>
          <p className="mt-3 font-label text-sm uppercase tracking-[0.3em] text-chalk-2">{subject}</p>
        </div>
        <Logos logos={logos} />
      </div>
      <div className="flex min-h-0 flex-1 gap-10 pt-6">
        <div className="flex min-w-0 flex-1 flex-col">
          <Board spec={spec} t={0} still className="w-full" />
          <Legend className="mt-4" tones={tonesOf(spec)} tokens={tokensOf(spec)} />
        </div>
        <ol className="flex w-[420px] shrink-0 flex-col justify-center gap-4">
          {spec.steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center border-2 border-accent font-pixel text-base text-accent">{i + 1}</span>
              <span>
                <span className="block font-pixel text-lg leading-tight">{s.title}</span>
                <span className="mt-0.5 block text-[0.8rem] leading-snug text-chalk-2">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The poster, rebuilt from the site's own type and marks so it prints sharp. */
export function Poster() {
  return (
    <section className="flex h-[1080px] w-[1920px] flex-col items-center justify-center bg-night text-chalk" style={DOTS}>
      <p className="font-pixel text-[13rem] leading-none tracking-tight">ROVER<span className="text-accent">/</span>HIRE</p>
      <p className="mt-14 font-mono text-4xl tracking-wide text-chalk-2">Hire a rover. Check every move.</p>
      <div className="mt-16 h-px w-[52rem] bg-night-rule" />
      <p className="mt-16 font-label text-lg uppercase tracking-[0.6em] text-chalk-2">Built on</p>
      <div className="mt-10 flex items-center gap-24">
        <div className="flex flex-col items-center gap-10">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, a small local mark */}
          <img src="/brand/hedera.png" alt="Hedera" className="h-36" />
          <p className="font-label text-lg uppercase tracking-[0.4em] text-chalk-2">Hedera · x402 · HCS · ERC-8004</p>
        </div>
        <span className="font-pixel text-7xl text-accent">×</span>
        <div className="flex flex-col items-center gap-10">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, a small local mark */}
          <img src="/brand/0g.png" alt="0G" className="h-32" />
          <p className="font-label text-lg uppercase tracking-[0.4em] text-chalk-2">0G Compute (TEE) · 0G Storage</p>
        </div>
      </div>
      <p className="mt-20 font-label text-lg uppercase tracking-[0.4em] text-chalk-2">
        Pay in USDC on <span className="text-chalk">Hedera</span> · <span style={{ color: TONE.base.ink }}>Base</span> · <span style={{ color: TONE.solana.ink }}>Solana</span>
      </p>
    </section>
  );
}
