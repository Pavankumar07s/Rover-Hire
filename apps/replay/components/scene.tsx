"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PIXELS } from "@/lib/pixels";

// The hero animation: an agent hires the rover, pays per move, the rover drives round the parcel taking five photos,
// and each photo flies back to the agent. Then the agent buys one signed room reading from Station-A, the sensor
// station on the same marketplace, for its report. Drawn on a 160×112 grid and stepped at 12 fps so motion stays pixel-snapped.
const T = 18_500;
const FPS = 12;
const CHALK = "#f2ede3";
const DIM = "#a39d90";
const ACCENT = "#ff6a13";
const MOVE = "#3987e5";
const PHOTO = "#d55181";
const GOOD = "#2fbf4f";
const SUN = "#e8c547"; // Station-A's reading, as on the architecture boards

const PARCEL = [".........", ".#######.", ".#..*..#.", ".#######.", ".#.....#.", ".#.###.#.", ".#.....#.", ".#######.", "........."];
const COIN = [".###.", "#####", "##.##", "#####", ".###."];
const LOCK = [".###.", ".#.#.", "#####", "##.##", "#####"];

const CENTER = { x: 116, y: 58 };
const START = { x: 90, y: 96 };
const STOPS = [{ x: 90, y: 60 }, { x: 98, y: 32 }, { x: 134, y: 32 }, { x: 142, y: 60 }, { x: 130, y: 88 }];
const AGENT = { x: 70, y: 52 };
const slot = (i: number) => ({ x: 9 + i * 12, y: 76 });
const LEG0 = 3000;
const LEG = 2000;
const STATION_AT = { x: 148, y: 17 };
const READ_SLOT = { x: 9, y: 93 };
// After the last photo (ms from S0): pay until S_PAY, the sensors read until S_READ, the signed reading flies until S_FLY.
const S0 = LEG0 + 5 * LEG, S_PAY = 600, S_READ = 1400, S_FLY = 2400;
const DONE = S0 + S_FLY + 200;
// Within each leg (ms): pay until PAY, the TEE decides until DECIDE, drive until DRIVE, flash until FLASH, then the photo flies back.
const PAY = 600, DECIDE = 900, DRIVE = 1500, FLASH = 1650;

type Pt = { x: number; y: number };
const lerp = (a: Pt, b: Pt, p: number, arc = 0): Pt => ({
  x: Math.round(a.x + (b.x - a.x) * p), y: Math.round(a.y + (b.y - a.y) * p - arc * Math.sin(Math.PI * p)),
});
const clamp = (v: number) => Math.max(0, Math.min(1, v));

function Sprite({ rows, at, cell = 1, colors, flip = false }: { rows: readonly string[]; at: Pt; cell?: number; colors: Record<string, string>; flip?: boolean }) {
  const w = rows[0]!.length;
  const ox = at.x - (w * cell) / 2, oy = at.y - (rows.length * cell) / 2;
  return <>{rows.flatMap((r, y) => [...r].map((c, x) => (colors[c]
    ? <rect key={`${x}-${y}`} x={ox + (flip ? w - 1 - x : x) * cell} y={oy + y * cell} width={cell} height={cell} fill={colors[c]} /> : null)))}</>;
}

/** Everything on screen at time t (ms into the loop). */
function frame(t: number) {
  const leg = t < LEG0 ? -1 : Math.min(4, Math.floor((t - LEG0) / LEG));
  const lt = t - LEG0 - Math.max(0, leg) * LEG;
  const prev = (i: number) => (i === 0 ? START : STOPS[i - 1]!);
  let rover: Pt = START;
  let moving = false;
  if (t >= LEG0) {
    const done = t >= LEG0 + 5 * LEG;
    rover = done ? STOPS[4]! : lt < DECIDE ? prev(leg) : lerp(prev(leg), STOPS[leg]!, clamp((lt - DECIDE) / (DRIVE - DECIDE)));
    moving = !done && lt >= DECIDE && lt < DRIVE;
  }
  const photos = t < LEG0 ? 0 : Math.min(5, Math.floor((t - LEG0) / LEG) + (lt >= 2000 ? 1 : 0));
  const inLeg = leg >= 0 && t < LEG0 + 5 * LEG;
  const st = t - S0;
  const buying = st >= 0 && st < S_FLY;
  const stage = t < LEG0 ? "hire" : buying ? (st < S_PAY ? "pay" : "read") : !inLeg ? "deliver"
    : lt < PAY ? "pay" : lt < DECIDE ? "decide" : lt < FLASH ? "shoot" : "deliver";
  const slotTag = { x: READ_SLOT.x + 13, y: READ_SLOT.y + 3.5 };
  return {
    rover, moving, photos, stage, leg,
    coin: inLeg && lt < PAY ? lerp(AGENT, rover, lt / PAY, 12) : null,
    lock: inLeg && lt >= PAY && lt < DECIDE,
    flash: inLeg && lt >= DRIVE && lt < FLASH,
    card: inLeg && lt >= FLASH ? lerp(rover, { x: slot(leg).x + 5, y: slot(leg).y + 4 }, (lt - FLASH) / (LEG - FLASH), 14) : null,
    filled: inLeg && lt >= FLASH ? leg : photos,
    status: buying ? (st < S_PAY ? "pay 0.001 USDC" : st < S_READ ? "Station-A: reading" : "reading, signed")
      : !inLeg ? "" : lt < PAY ? "pay 0.015 USDC" : lt < DECIDE ? "0G TEE: next move" : lt < DRIVE ? `driving · photo ${leg + 1}` : lt < FLASH ? `photo ${leg + 1}/5` : `photo ${leg + 1}/5 sent`,
    stationCoin: st >= 0 && st < S_PAY ? lerp(AGENT, STATION_AT, st / S_PAY, 12) : null,
    sensing: st >= S_PAY && st < S_READ,
    reading: st >= S_READ && st < S_FLY ? lerp(STATION_AT, slotTag, (st - S_READ) / (S_FLY - S_READ), 10) : null,
    read: st >= S_FLY,
  };
}

const LINES = [
  { at: 0, text: "> find agents", tone: CHALK },
  { at: 1200, text: "  Rover-A + Station-A", tone: DIM },
  { at: 2000, text: "> hire: 5 photos", tone: CHALK },
];

function typed(text: string, t: number, at: number): string {
  if (t < at) return "";
  return text.slice(0, Math.max(1, Math.floor((t - at) / 45)));
}

export function HeroScene() {
  const [t, setT] = useState(0);
  const [trail, setTrail] = useState<Pt[]>([]);
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const still = setTimeout(() => setT(DONE + 400), 0); // the finished frame, no motion
      return () => clearTimeout(still);
    }
    let start = performance.now();
    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; });
    if (ref.current) io.observe(ref.current);
    const id = setInterval(() => {
      if (!visible || document.hidden) { start += 1000 / FPS; return; }
      const now = (performance.now() - start) % T;
      setT(now);
      const f = frame(now);
      setTrail((tr) => (now < 200 ? [] : f.moving ? [...tr, { x: f.rover.x, y: f.rover.y + 9 }] : tr));
    }, 1000 / FPS);
    return () => { clearInterval(id); io.disconnect(); };
  }, []);

  const f = frame(t);
  const fading = t > T - 600;
  return (
    <figure>
      <svg ref={ref} viewBox="0 0 160 112" className="block w-full bg-night" shapeRendering="crispEdges" role="img"
        aria-label="Animation: an AI agent finds Rover-A and Station-A, hires the rover and pays per move; the rover drives round the parcel taking five photos, each photo goes back to the agent, then the agent pays Station-A for one signed reading of the room.">
        <defs>
          <pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse"><rect x="1.5" y="1.5" width="1" height="1" fill={CHALK} opacity="0.08" /></pattern>
        </defs>
        <rect width="160" height="112" fill="url(#dots)" />
        <g opacity={fading ? 0 : 1} style={{ transition: "opacity 0.5s" }}>
          <Agent t={t} f={f} />
          <rect x="76.5" y="8.5" width="79" height="95" fill="none" stroke={DIM} strokeOpacity="0.35" strokeDasharray="2 2" />
          <text x="78" y="7" fontSize="3.6" fill={DIM} style={{ fontFamily: "var(--font-label)" }}>FLOOR · REAL ROVER</text>
          {trail.map((p, i) => <rect key={i} x={p.x} y={p.y} width="1" height="1" fill={MOVE} />)}
          <Sprite rows={PARCEL} at={CENTER} cell={2} colors={{ "#": DIM, "*": ACCENT }} />
          <text x={CENTER.x} y={CENTER.y + 15} fontSize="3.4" fill={DIM} textAnchor="middle" style={{ fontFamily: "var(--font-label)" }}>#3</text>
          <Sprite rows={PIXELS.rover} at={f.rover} cell={2} colors={{ "#": CHALK, "*": ACCENT }} flip={f.rover.x > CENTER.x} />
          {f.lock && <><Sprite rows={LOCK} at={{ x: f.rover.x, y: f.rover.y - 15 }} colors={{ "#": CHALK }} />
            <text x={f.rover.x + 5} y={f.rover.y - 13} fontSize="3.4" fill={CHALK} style={{ fontFamily: "var(--font-label)" }}>TEE</text></>}
          {f.flash && [[-7, -7], [7, -7], [-9, 0], [9, 0], [0, -10]].map(([dx, dy], i) => (
            <rect key={i} x={f.rover.x + dx! - 1} y={f.rover.y + dy! - 1} width="2" height="2" fill={i % 2 ? PHOTO : CHALK} />
          ))}
          <Sprite rows={PIXELS.station} at={STATION_AT} colors={{ "#": DIM, "*": f.sensing && Math.floor(t / 125) % 2 === 0 ? SUN : DIM }} />
          <text x={STATION_AT.x - 7} y={STATION_AT.y + 1.5} fontSize="3.4" fill={f.sensing ? SUN : DIM} textAnchor="end" style={{ fontFamily: "var(--font-label)" }}>STATION-A</text>
          {f.coin && <Sprite rows={COIN} at={f.coin} colors={{ "#": ACCENT }} />}
          {f.stationCoin && <Sprite rows={COIN} at={f.stationCoin} colors={{ "#": ACCENT }} />}
          {f.card && <Card at={f.card} />}
          {f.reading && <rect x={f.reading.x - 4} y={f.reading.y - 2.5} width="8" height="5" fill={SUN} />}
        </g>
      </svg>
      <Steps stage={f.stage} />
    </figure>
  );
}

function Card({ at }: { at: Pt }) {
  return (
    <g>
      <rect x={at.x - 5} y={at.y - 4} width="10" height="8" fill={PHOTO} />
      <rect x={at.x - 4} y={at.y - 3} width="8" height="6" fill="#0a0a0a" />
      <rect x={at.x - 2} y={at.y - 1} width="4" height="3" fill={DIM} />
      <rect x={at.x - 1} y={at.y - 1} width="1" height="1" fill={ACCENT} />
    </g>
  );
}

function Agent({ t, f }: { t: number; f: ReturnType<typeof frame> }) {
  const done = t >= DONE;
  const cursor = Math.floor(t / 400) % 2 === 0;
  return (
    <g>
      <rect x="4.5" y="8.5" width="66" height="95" fill="#151515" stroke={DIM} strokeOpacity="0.6" />
      <rect x="5" y="9" width="65" height="7" fill="#1f1f1f" />
      {[0, 1, 2].map((i) => <rect key={i} x={7 + i * 4} y="11" width="2" height="2" fill={i ? DIM : ACCENT} />)}
      <text x="20" y="14.4" fontSize="3.6" fill={DIM} style={{ fontFamily: "var(--font-label)" }}>AI AGENT</text>
      {LINES.map((l, i) => <Line key={i} y={25 + i * 8} tone={l.tone}>{typed(l.text, t, l.at)}</Line>)}
      <Line y={49} tone={f.status.startsWith("pay") ? ACCENT : f.status.startsWith("0G") || f.status.startsWith("driving") ? CHALK
        : f.status.startsWith("Station") || f.status.startsWith("reading") ? SUN : PHOTO}>{f.status ? `  ${f.status}` : ""}</Line>
      {done ? <Line y={57} tone={GOOD}>OK 5 photos + reading</Line>
        : <rect x="8" y={t < LEG0 ? 21 + LINES.filter((l) => t >= l.at).length * 8 : 53} width="2" height="4" fill={CHALK} opacity={cursor ? 1 : 0} />}
      <text x="8" y="72" fontSize="3.2" fill={DIM} style={{ fontFamily: "var(--font-label)" }}>PHOTOS RECEIVED</text>
      {[0, 1, 2, 3, 4].map((i) => {
        const s = slot(i);
        return i < f.filled
          ? <g key={i}><Card at={{ x: s.x + 5, y: s.y + 4 }} />{done && <rect x={s.x - 1} y={s.y + 9} width="12" height="1" fill={GOOD} />}</g>
          : <rect key={i} x={s.x + 0.5} y={s.y + 0.5} width="9" height="7" fill="none" stroke={DIM} strokeOpacity="0.4" strokeDasharray="1 1" />;
      })}
      <text x="8" y="90" fontSize="3.2" fill={DIM} style={{ fontFamily: "var(--font-label)" }}>SIGNED READING</text>
      {f.read
        ? <g>
            <rect x={READ_SLOT.x} y={READ_SLOT.y} width="26" height="7" fill={SUN} />
            <rect x={READ_SLOT.x + 1} y={READ_SLOT.y + 1} width="24" height="5" fill="#0a0a0a" />
            <text x={READ_SLOT.x + 13} y={READ_SLOT.y + 4.9} fontSize="3.2" fill={SUN} textAnchor="middle" style={{ fontFamily: "var(--font-label)" }}>24.1C 61%</text>
            {done && <rect x={READ_SLOT.x - 1} y={READ_SLOT.y + 8} width="28" height="1" fill={GOOD} />}
          </g>
        : <rect x={READ_SLOT.x + 0.5} y={READ_SLOT.y + 0.5} width="25" height="6" fill="none" stroke={DIM} strokeOpacity="0.4" strokeDasharray="1 1" />}
    </g>
  );
}

function Line({ y, tone, children }: { y: number; tone: string; children: ReactNode }) {
  return <text x="8" y={y} fontSize="4.4" fill={tone} style={{ fontFamily: "var(--font-pixel)" }} xmlSpace="preserve">{children}</text>;
}

const STEPS = [["hire", "Hire"], ["pay", "Pay"], ["decide", "0G decides"], ["shoot", "Drive + shoot"], ["read", "Read sensors"], ["deliver", "Deliver"]] as const;

function Steps({ stage }: { stage: string }) {
  return (
    <ol className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-label text-[10px] uppercase tracking-[0.08em]" aria-hidden>
      {STEPS.map(([k, label], i) => (
        <li key={k} className={`flex items-center gap-1.5 ${stage === k ? "text-chalk" : "text-chalk-2/50"}`}>
          <span className={`h-1.5 w-1.5 ${stage === k ? "bg-accent" : "bg-chalk-2/40"}`} />{String(i + 1).padStart(2, "0")} {label}
        </li>
      ))}
    </ol>
  );
}
