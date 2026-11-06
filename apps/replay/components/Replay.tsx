"use client";

import { GALILEO } from "@0xBs/zg/browser";
import { isAddress } from "ethers";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { DEFAULT_LOG, DEFAULT_ROVER, STATION } from "@/lib/config";
import { listEpisodes, type Episode } from "@/lib/episodes";
import type { PixelName } from "@/lib/pixels";
import { short, time } from "@/lib/util";
import { BackToTop, Btn, Footer, Heading, Index, Marquee, Nav, ScrollProgress } from "./chrome";
import { EpisodeView } from "./EpisodeView";
import { Glyph, Pixel, PixelField, PixelLoader } from "./pixel";
import { HeroScene } from "./scene";
import { Disclosure, Ext } from "./ui";

interface Route { log: string; rover: string; episode: string | null }

const LATEST = "latest"; // ?episode=latest opens the newest finished mission, so its buttons work before the list is read

function readRoute(): Route {
  const q = new URLSearchParams(window.location.search);
  return { log: q.get("log") ?? DEFAULT_LOG, rover: q.get("rover") ?? DEFAULT_ROVER, episode: q.get("episode") };
}

function href(r: Route): string {
  const q = new URLSearchParams();
  if (r.episode) q.set("episode", r.episode);
  if (r.log !== DEFAULT_LOG) q.set("log", r.log);
  if (r.rover !== DEFAULT_ROVER) q.set("rover", r.rover);
  const s = q.toString();
  return s ? `?${s}` : window.location.pathname;
}

export function Replay() {
  const [route, setRoute] = useState<Route | null>(null);
  const [data, setData] = useState<{ source: string; episodes: Episode[] | null; error: string | null } | null>(null);
  const log = route?.log;
  const rover = route?.rover;
  const source = `${log}|${rover}`;
  const episodes = data?.source === source ? data.episodes : null;
  const error = data?.source === source ? data.error : null;

  useEffect(() => {
    const sync = () => setRoute(readRoute());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (!log || !rover) return;
    let live = true;
    const source = `${log}|${rover}`;
    listEpisodes(log, rover)
      .then((episodes) => live && setData({ source, episodes, error: null }))
      .catch((e) => live && setData({ source, episodes: null, error: (e as Error).message }));
    return () => { live = false; };
  }, [log, rover]);

  const go = useCallback((r: Route, e?: MouseEvent) => {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return; // let the browser open a new tab
    e?.preventDefault();
    window.history.pushState(null, "", href(r));
    setRoute(r);
    window.scrollTo({ top: 0 });
  }, []);

  const featured = episodes?.find((e) => e.ended) ?? null; // newest first: the latest finished mission

  // Once the list is read, the address shows the mission's own id, so it can be shared.
  useEffect(() => {
    if (route?.episode === LATEST && featured) window.history.replaceState(null, "", href({ ...route, episode: featured.id }));
  }, [route, featured]);

  if (!route) return null;
  const ep = route.episode === LATEST ? featured : route.episode ? episodes?.find((e) => e.id === route.episode) : null;
  const home = { ...route, episode: null };
  const loading = !episodes && !error;
  const target = featured?.id ?? (loading ? LATEST : null);
  const latest = target ? { href: href({ ...route, episode: target }), onClick: (e: MouseEvent<HTMLAnchorElement>) => go({ ...route, episode: target }, e), loading } : null;

  return (
    <>
      <ScrollProgress />
      <Nav home={href(home)} onHome={(e) => go(home, e)} onSection={(id) => (e) => {
        e.preventDefault();
        if (route.episode) go(home);
        setTimeout(() => document.getElementById(id)?.scrollIntoView(), route.episode ? 80 : 0);
      }} latest={latest} />
      <main>
        {error && (
          <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
            <p className="flex items-start gap-3 border-2 border-bad p-4" role="alert"><Pixel name="cross" size={18} grid={false} className="text-bad" />
              Could not read the mission log on 0G Galileo: {error}</p>
          </div>
        )}
        {route.episode ? (
          ep ? <EpisodeView key={ep.key} ep={ep} rover={route.rover} homeHref={href(home)} onHome={(e) => go(home, e)} />
            : <div className="mx-auto max-w-6xl px-4 sm:px-6">
                {episodes ? <p className="py-16">{route.episode === LATEST ? "This rover has no finished mission on this log yet." : `Mission ${route.episode} was not started by this rover on this log.`}</p> : !error && <PixelLoader label="Reading the mission log on 0G Galileo" />}
              </div>
        ) : (
          <Home episodes={episodes} error={error} route={route} latest={latest}
            open={(id, e) => go({ ...route, episode: id }, e)} hrefOf={(id) => href({ ...route, episode: id })} apply={(log, rover) => go({ log, rover, episode: null })} />
        )}
      </main>
      <Footer />
      <BackToTop />
    </>
  );
}

const STEPS: { icon: PixelName; label: string; kicker: string; title: string; text: string }[] = [
  { icon: "card", label: "Hire", kicker: "ERC-8004 + A2A", title: "An agent finds and hires the rover",
    text: "Claude looks the rover up in the ERC-8004 registry on Hedera, checks its rating and negotiates a price per move and per photo." },
  { icon: "lock", label: "Decide", kicker: "0G Compute · TEE", title: "A sealed model picks every move",
    text: "Each step, the rover sends its camera frame to a model running inside a 0G TEE. The answer comes back signed by the enclave's key." },
  { icon: "coin", label: "Pay", kicker: "x402 · USDC", title: "Each move is paid before it happens",
    text: "The rover only drives once the move's USDC payment has settled, on Hedera, Base or Solana: you choose. No payment, no motion." },
  { icon: "storage", label: "Record", kicker: "0G Storage · Galileo", title: "Every step is stored and anchored",
    text: "The decision, the frame the model saw and the payment go into a hash chain, stored on 0G Storage and anchored on chain." },
];

function Home({ episodes, error, route, latest, open, hrefOf, apply }: {
  episodes: Episode[] | null; error: string | null; route: Route;
  latest: { href: string; onClick: (e: MouseEvent<HTMLAnchorElement>) => void; loading: boolean } | null;
  open: (id: string, e: MouseEvent) => void; hrefOf: (id: string) => string; apply: (log: string, rover: string) => void;
}) {
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(0);
  const ended = episodes?.filter((e) => e.ended && e.idMatches) ?? [];
  const shown = all ? episodes ?? [] : ended;
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages - 1);
  const turn = (p: number) => { setPage(p); document.getElementById("missions")?.scrollIntoView(); };
  const decisions = ended.reduce((a, e) => a + (e.ended?.decisions ?? 0), 0);
  return (
    <>
      <section className="bg-night text-chalk">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-20">
          <div className="flex flex-col justify-center">
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-chalk-2">
              <span className="h-2 w-2 bg-accent" />Live on 0G Galileo · Hedera testnet
            </p>
            <h1 className="mt-6 font-pixel text-5xl leading-[0.95] sm:text-7xl">Hire a rover.<br />Check every move.</h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed">
              An AI agent hires this rover and pays it per move in USDC, and buys signed readings from Station-A, a sensor station on the
              same marketplace. <span className="text-chalk-2">Every rover decision comes from a model sealed in a 0G TEE, and every step and
              every sale is on a public ledger. Replay any mission and verify it yourself.</span>
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {latest && <Btn href={latest.href} onClick={latest.onClick} loading={latest.loading} tone="primary">Replay latest mission</Btn>}
              <Btn href="#how" tone="night">How it works</Btn>
              <Btn href="/hire/" tone="night">Hire it from your AI</Btn>
            </div>
          </div>
          <div>
            <div className="border border-night-rule p-2"><HeroScene /></div>
            <p className="mt-3 font-mono text-xs leading-relaxed text-chalk-2">An AI agent (Claude Desktop or ChatGPT in our runs, or any MCP client) hires Rover-A, pays per move and gets every photo back, then buys a signed room reading from Station-A for its report.</p>
          </div>
        </div>
      </section>

      <Marquee items={[
        "Rover for hire",
        episodes ? `${ended.length} missions on chain` : "Reading the chain",
        episodes ? `${decisions} AI decisions recorded` : "0G Galileo",
        "0G Compute · TEE", "0G Storage", "Hedera · USDC per move", "Station-A · signed readings", "ERC-8004 identity", "Verified in your browser",
      ]} />

      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-20 sm:px-6">
        <Heading label="How it works" title="Four steps, all on public ledgers." />
        <ol className="grid gap-px border-y border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.label} className="group bg-paper px-1 py-8 sm:px-6">
              <Index n={String(i + 1).padStart(2, "0")} label={s.label} />
              <Pixel name={s.icon} size={56} className="mt-6 text-ink" />
              <p className="mt-6 font-label text-xs uppercase tracking-[0.16em] text-ink-2">{s.kicker}</p>
              <h3 className="mt-2 font-pixel text-2xl leading-snug">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="station" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-20 sm:px-6">
        <Heading label="Also for hire" title="Station-A sells signed readings." />
        <div className="grid gap-px border-y border-rule bg-rule lg:grid-cols-[1.2fr_1fr]">
          <div className="flex gap-6 bg-paper px-1 py-8 sm:px-6">
            <Pixel name="station" size={56} className="shrink-0 text-ink" />
            <div>
              <p className="leading-relaxed">
                The marketplace isn&apos;t only for the rover. Station-A is a second Arduino UNO Q that sells readings of the room:
                temperature, humidity, light and motion, each one signed by the station&apos;s own key.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">
                An agent finds it on the same ERC-8004 registry (#{STATION.agentId}), pays 0.001 USDC a reading with x402, and every sale goes on a public
                Hedera topic. No 0G here: it makes no decisions, it only measures.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Btn href="/station/" tone="paper">See its sales</Btn>
                <Btn href="/architecture/station/" tone="paper">How it works</Btn>
              </div>
            </div>
          </div>
          <ul className="grid grid-rows-4 gap-px bg-rule">
            {[["0.001", "USDC a reading"], [`#${STATION.agentId}`, "on ERC-8004"], [STATION.topic, "public sales topic"], ["4", "sensors, one signature"]].map(([v, l]) => (
              <li key={l} className="flex items-center justify-between gap-4 bg-paper px-1 py-4 sm:px-6">
                <span className="font-mono text-lg">{v}</span>
                <span className="font-label text-xs uppercase tracking-[0.16em] text-ink-2">{l}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="missions" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-20 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Heading label="Missions" title="Every mission the rover has run." sub="Read straight from the mission log contract on 0G Galileo, newest first. Pick one to replay and verify it." />
          {episodes && episodes.length > ended.length && (
            <label className="mb-8 inline-flex cursor-pointer items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={all} onChange={(e) => { setAll(e.target.checked); setPage(0); }} className="h-4 w-4 accent-[#141414]" />
              Show {episodes.length - ended.length} unfinished test runs
            </label>
          )}
        </div>
        {!episodes ? !error && <PixelLoader label="Reading the rover's missions from 0G Galileo" /> : (
          <>
          <ul className="border-t border-ink">
            {shown.slice(current * PAGE, (current + 1) * PAGE).map((e, i) => (
              <li key={e.key} className="border-b border-rule">
                <a href={hrefOf(e.id)} onClick={(ev) => open(e.id, ev)}
                  className="group grid grid-cols-[2.5rem_1fr_auto] items-center gap-x-4 gap-y-1 py-4 hover:bg-paper-2 sm:grid-cols-[3rem_minmax(0,1fr)_12rem_8rem_7rem]">
                  <span className="pl-2 font-mono text-xs text-ink-2">{String(current * PAGE + i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-pixel text-xl" title={e.mission}>{e.mission || "Mission"}</span>
                    <span className="mt-1 block font-mono text-xs text-ink-2">{e.id}{e.photosWanted ? ` · ${e.photosWanted} photos` : ""}</span>
                  </span>
                  <span className="hidden font-mono text-xs text-ink-2 sm:block">{time(e.startedAt)}</span>
                  <span className="hidden font-mono text-xs text-ink-2 sm:block">{e.ended ? `${e.ended.decisions} decisions` : "unfinished"}</span>
                  <span className="inline-flex items-center justify-end gap-2 pr-2 font-label text-xs uppercase tracking-[0.14em]">
                    <span className="border-b-2 border-accent group-hover:bg-accent">Replay</span><Glyph name="next" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {pages > 1 && <Pager page={current} pages={pages} total={shown.length} onPage={turn} />}
          </>
        )}
        <Disclosure className="mt-8" summary="Read another rover or log">
          <Settings route={route} onApply={apply} />
        </Disclosure>
      </section>

      <section id="verify" className="relative mt-24 scroll-mt-20 overflow-hidden bg-night text-chalk">
        <PixelField />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 py-24 text-center sm:px-6">
          <Pixel name="shield" size={64} className="text-chalk" />
          <h2 className="mt-8 font-pixel text-4xl leading-tight sm:text-6xl">Don&apos;t trust us.<br />Check it.</h2>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-chalk-2">
            Each replay downloads the raw records from 0G Storage, recomputes their roots, checks every TEE signature against 0G&apos;s registry and
            looks up every payment on the chain that paid it, inside your browser.
          </p>
          {latest && <div className="mt-8"><Btn href={latest.href} onClick={latest.onClick} loading={latest.loading} tone="primary">Replay and verify</Btn></div>}
        </div>
      </section>
    </>
  );
}

const PAGE = 10;

function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  const btn = "inline-flex h-10 min-w-10 items-center justify-center gap-2 border border-ink px-3 font-label text-xs uppercase tracking-[0.12em] hover:bg-ink hover:text-paper disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink";
  return (
    <nav className="mt-6 flex flex-wrap items-center justify-between gap-4" aria-label="Mission pages">
      <p className="font-mono text-xs text-ink-2">{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page"><Glyph name="prev" />Prev</button>
        {Array.from({ length: pages }, (_, p) => (
          <button key={p} onClick={() => onPage(p)} aria-current={p === page ? "page" : undefined}
            className={`${btn} ${p === page ? "border-accent bg-accent text-night hover:border-ink" : ""}`}>{String(p + 1).padStart(2, "0")}</button>
        ))}
        <button className={btn} onClick={() => onPage(page + 1)} disabled={page === pages - 1} aria-label="Next page">Next<Glyph name="next" /></button>
      </div>
    </nav>
  );
}

function Settings({ route, onApply }: { route: Route; onApply: (log: string, rover: string) => void }) {
  const [log, setLog] = useState(route.log);
  const [rover, setRover] = useState(route.rover);
  const valid = isAddress(log) && isAddress(rover);
  return (
    <form className="grid gap-4 border border-rule p-4 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); if (valid) onApply(log, rover); }}>
      <label className="font-label text-xs uppercase tracking-[0.14em] text-ink-2">Mission log contract
        <input value={log} onChange={(e) => setLog(e.target.value.trim())} className="mt-1.5 w-full border border-ink bg-paper px-3 py-2 font-mono text-sm normal-case tracking-normal text-ink" />
      </label>
      <label className="font-label text-xs uppercase tracking-[0.14em] text-ink-2">Rover address
        <input value={rover} onChange={(e) => setRover(e.target.value.trim())} className="mt-1.5 w-full border border-ink bg-paper px-3 py-2 font-mono text-sm normal-case tracking-normal text-ink" />
      </label>
      <button disabled={!valid} className="self-end border border-ink bg-ink px-4 py-2.5 font-label text-xs uppercase tracking-[0.14em] text-paper hover:bg-accent hover:text-night disabled:opacity-40">Load</button>
      <p className="text-xs text-ink-2 sm:col-span-3">Now reading <Ext href={`${GALILEO.explorer}/address/${route.log}`}>{short(route.log)}</Ext> for rover <code>{short(route.rover)}</code>.</p>
    </form>
  );
}
