"use client";

import { GALILEO, MAINNET } from "@0xBs/zg/browser";
import { useEffect, useState, type MouseEventHandler, type ReactNode } from "react";
import { DEFAULT_LOG, MAINNET_EXPLORER, ROVER_A, STATION } from "@/lib/config";
import { Glyph, Pixel, PixelDots, PixelField } from "./pixel";

export function ScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const on = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setP(max > 0 ? window.scrollY / max : 0);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, []);
  return <div className="fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-accent" style={{ transform: `scaleX(${p})` }} aria-hidden />;
}

export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 700);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <button onClick={() => window.scrollTo({ top: 0 })} aria-label="Back to top"
      className={`fixed bottom-5 right-5 z-40 grid h-12 w-12 place-items-center rounded-full border-2 border-accent bg-night text-chalk transition-opacity ${show ? "opacity-100" : "pointer-events-none opacity-0"}`}>
      <Glyph name="up" className="text-base" />
    </button>
  );
}

type BtnTone = "primary" | "night" | "paper";

export function Btn({ href, onClick, tone = "paper", children, bullet = true, loading = false, className = "" }: {
  href: string; onClick?: MouseEventHandler<HTMLAnchorElement>; tone?: BtnTone; children: ReactNode; bullet?: boolean; loading?: boolean; className?: string;
}) {
  const cls = {
    primary: "border-accent bg-accent text-night hover:bg-chalk hover:border-chalk",
    night: "border-chalk/60 text-chalk hover:bg-chalk hover:text-night",
    paper: "border-ink text-ink hover:bg-ink hover:text-paper",
  }[tone];
  return (
    <a href={href} onClick={onClick} className={`inline-flex items-center gap-2.5 border px-4 py-3 font-label text-xs uppercase tracking-[0.14em] transition-colors ${cls} ${className}`}>
      {bullet && <span className="h-1.5 w-1.5 bg-current" aria-hidden />}{children}{loading && <PixelDots />}
    </a>
  );
}

/** NEAR-style section index: [ 01 / PHOTOS ] */
export function Index({ n, label, night = false }: { n?: string; label: string; night?: boolean }) {
  return <p className={`font-mono text-xs uppercase tracking-[0.18em] ${night ? "text-chalk-2" : "text-ink-2"}`}>[ {n ? `${n} / ` : ""}{label} ]</p>;
}

export function Heading({ n, label, title, sub }: { n?: string; label: string; title: string; sub?: string }) {
  return (
    <div className="mb-8">
      <Index n={n} label={label} />
      <h2 className="mt-3 font-pixel text-3xl leading-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">{sub}</p>}
    </div>
  );
}

export function Nav({ home, onHome, onSection, latest }: {
  home: string; onHome: MouseEventHandler<HTMLAnchorElement>; onSection: (id: string) => MouseEventHandler<HTMLAnchorElement>;
  latest: { href: string; onClick: MouseEventHandler<HTMLAnchorElement>; loading: boolean } | null;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-night-rule bg-night text-chalk">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <a href={home} onClick={onHome} className="flex items-center gap-2.5" aria-label="Rover for Hire, home">
          <Pixel name="rover" size={30} grid={false} className="text-chalk" />
          <span className="font-pixel text-xl leading-none tracking-wide">ROVER<span className="text-accent">/</span>HIRE</span>
        </a>
        {/* the six links fit on one line from lg; below it the hero's buttons lead on */}
        <div className="hidden items-center gap-6 whitespace-nowrap font-mono text-xs uppercase tracking-[0.18em] text-chalk-2 lg:flex">
          <a href="#how" onClick={onSection("how")} className="hover:text-chalk">How it works</a>
          <a href="#missions" onClick={onSection("missions")} className="hover:text-chalk">Missions</a>
          <a href="#verify" onClick={onSection("verify")} className="hover:text-chalk">Verify</a>
          <a href="/architecture/" className="hover:text-chalk">Architecture</a>
          <a href="/live/" className="hover:text-chalk">Live</a>
          <a href="/hire/" className="hover:text-chalk">Hire it</a>
        </div>
        {/* on a phone the dots would wrap the label; the hero button below shows them */}
        {latest && <Btn href={latest.href} onClick={latest.onClick} loading={latest.loading} tone="night" className="max-sm:[&_.px-dots]:hidden">Replay latest</Btn>}
      </nav>
    </header>
  );
}

export function Marquee({ items }: { items: string[] }) {
  const row = (hidden: boolean) => (
    <div className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {items.map((t) => (
        <span key={t} className="flex items-center gap-8 pr-8 font-mono text-xs uppercase tracking-[0.2em] text-ink">
          {t}<span className="h-2 w-2 bg-accent" />
        </span>
      ))}
    </div>
  );
  return (
    <div className="marquee overflow-hidden border-y border-rule bg-paper-2 py-3.5">
      <div className="marquee-track flex w-max">{row(false)}{row(true)}</div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-night-rule bg-night text-chalk">
      <PixelField />
      <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-16 sm:px-6">
        <p className="whitespace-nowrap font-pixel text-[16.5vw] leading-none tracking-tight lg:text-[11.4rem]" aria-label="Rover for Hire">
          ROVER<span className="text-accent">/</span>HIRE
        </p>
        <hr className="mt-12 border-night-rule" />
        <div className="mt-8 grid gap-8 text-sm sm:grid-cols-3">
          <div>
            <p className="font-label text-xs uppercase tracking-[0.18em] text-chalk-2">Built on</p>
            <p className="mt-2 leading-relaxed">0G Compute (TEE) · 0G Storage<br />Hedera · x402 · HCS · ERC-8004<br />USDC on Hedera, Base or Solana</p>
          </div>
          <div>
            <p className="font-label text-xs uppercase tracking-[0.18em] text-chalk-2">Check the sources</p>
            <ul className="mt-2 space-y-1">
              <li><a className="inline-flex items-center gap-2 hover:text-accent" target="_blank" rel="noreferrer" href={`${GALILEO.explorer}/address/${DEFAULT_LOG}`}>Mission log on 0G Galileo <Glyph name="ext" /></a></li>
              <li><a className="inline-flex items-center gap-2 hover:text-accent" target="_blank" rel="noreferrer" href={`${MAINNET_EXPLORER}/address/${MAINNET.inferenceServing}`}>0G TEE signer registry <Glyph name="ext" /></a></li>
              <li><a className="inline-flex items-center gap-2 hover:text-accent" target="_blank" rel="noreferrer" href={`https://hashscan.io/testnet/account/${ROVER_A.account}`}>Rover-A on HashScan <Glyph name="ext" /></a></li>
              <li><a className="inline-flex items-center gap-2 hover:text-accent" target="_blank" rel="noreferrer" href={`https://hashscan.io/testnet/topic/${STATION.topic}`}>Station-A's sales on HashScan <Glyph name="ext" /></a></li>
            </ul>
          </div>
          <div>
            <p className="font-label text-xs uppercase tracking-[0.18em] text-chalk-2">Part of 0xBs</p>
            <p className="mt-2 leading-relaxed text-chalk-2">Everything on this site is read from public chains and recomputed in your browser. There is no server of ours behind it.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
