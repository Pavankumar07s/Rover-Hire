"use client";

import type { ReactNode } from "react";
import type { PixelName } from "@/lib/pixels";
import { Pixel } from "./pixel";

// The pitch deck's pages: 1920×1080, the site's night page with its dot grid, Geist Pixel titles, Silkscreen labels and
// mono text. ETHGlobal's rule for slides: at most four points on one page.
const DOTS = { backgroundImage: "radial-gradient(rgba(242,237,227,0.09) 1px, transparent 1.6px)", backgroundSize: "14px 14px" };
export const CHAIN_INK = { hedera: "#f2ede3", base: "#4f86ff", solana: "#19d3c5", "0g": "#a66cff" } as const;

export function Slide({ n, total, kicker, title, sub, center = false, children }:
  { n: number; total: number; kicker: string; title?: ReactNode; sub?: ReactNode; center?: boolean; children?: ReactNode }) {
  return (
    <section className="flex h-[1080px] w-[1920px] flex-col overflow-hidden bg-night px-20 py-14 text-chalk" style={DOTS}>
      <header className="flex items-center justify-between border-b border-night-rule pb-5">
        <p className="flex items-baseline gap-6">
          <span className="font-pixel text-3xl leading-none">ROVER<span className="text-accent">/</span>HIRE</span>
          <span className="font-label text-sm uppercase tracking-[0.3em] text-accent">{kicker}</span>
        </p>
        <p className="font-label text-sm tracking-[0.3em] text-chalk-2">{String(n).padStart(2, "0")} / {String(total).padStart(2, "0")}</p>
      </header>
      {title && <h1 className="mt-12 font-pixel text-[5.2rem] leading-[1.02]">{title}</h1>}
      {sub && <p className="mt-6 max-w-[1500px] font-mono text-[1.85rem] leading-snug text-chalk-2">{sub}</p>}
      <div className={`flex min-h-0 flex-1 flex-col pt-10 ${center ? "justify-center pb-10" : ""}`}>{children}</div>
    </section>
  );
}

/** At most four points, each behind an orange pixel square. */
export function Points({ items, size = "text-[1.9rem]" }: { items: ReactNode[]; size?: string }) {
  return (
    <ul className={`space-y-7 font-mono leading-snug ${size}`}>
      {items.slice(0, 4).map((t, i) => (
        <li key={i} className="flex gap-6"><span className="mt-[0.55em] h-3.5 w-3.5 shrink-0 bg-accent" /><span>{t}</span></li>
      ))}
    </ul>
  );
}

export function Card({ icon, label, title, children, foot, className = "", ink }:
  { icon?: PixelName; label: string; title: ReactNode; children?: ReactNode; foot?: ReactNode; className?: string; ink?: string }) {
  return (
    <div className={`flex flex-col border-2 border-night-rule bg-night-2 p-9 ${className}`} style={ink ? { borderColor: ink } : undefined}>
      <div className="flex items-start justify-between gap-4">
        <p className="font-label text-sm uppercase tracking-[0.25em]" style={{ color: ink ?? "#a39d90" }}>{label}</p>
        {icon && <Pixel name={icon} size={56} grid={false} className="shrink-0 text-chalk" />}
      </div>
      <p className="mt-4 font-pixel text-[2.9rem] leading-tight">{title}</p>
      {children && <div className="mt-5 font-mono text-[1.65rem] leading-snug text-chalk-2">{children}</div>}
      {foot && <div className="mt-auto pt-8">{foot}</div>}
    </div>
  );
}

/** The rover's LED face, as on its 8×13 matrix: what it shows when a rule stops it. */
export function Face({ text, big = false }: { text: string; big?: boolean }) {
  return <span className={`inline-block border-2 border-accent bg-night font-dots leading-none text-accent ${big ? "px-8 py-4 text-[6.5rem]" : "px-4 py-1 text-5xl"}`}>{text}</span>;
}

/** A short heading and its explanation, one row of a list. */
export function Row({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[30rem_1fr] gap-12 border-t border-night-rule py-8">
      <p className="font-pixel text-[2.3rem] leading-tight">{head}</p>
      <p className="font-mono text-[1.65rem] leading-snug text-chalk-2">{children}</p>
    </div>
  );
}

export function Chip({ children, ink = "#f2ede3" }: { children: ReactNode; ink?: string }) {
  return <span className="inline-block border-2 px-4 py-2 font-label text-base uppercase tracking-[0.15em]" style={{ borderColor: ink, color: ink }}>{children}</span>;
}

/** A requirement, and what in the build meets it. */
export function Need({ need, have }: { need: ReactNode; have: ReactNode }) {
  return (
    <div className="grid grid-cols-[34rem_1fr] gap-10 border-t border-night-rule py-6">
      <p className="flex gap-4 font-pixel text-[1.9rem] leading-tight"><Pixel name="check" size={30} grid={false} className="mt-1 shrink-0 text-good-night" />{need}</p>
      <p className="font-mono text-[1.45rem] leading-snug text-chalk-2">{have}</p>
    </div>
  );
}

/** One chat line, as the user or the AI wrote it. */
export function Bubble({ who, children }: { who: "you" | "ai"; children: ReactNode }) {
  return (
    <div className={`max-w-[46rem] border-2 p-6 font-mono text-[1.6rem] leading-snug ${who === "you" ? "self-end border-accent" : "self-start border-night-rule bg-night-2"}`}>
      <p className={`mb-2 font-label text-xs uppercase tracking-[0.25em] ${who === "you" ? "text-accent" : "text-chalk-2"}`}>{who === "you" ? "You" : "Claude"}</p>
      {children}
    </div>
  );
}
