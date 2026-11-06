"use client";

import { HASHSCAN, usdcString } from "@0xBs/hedera/browser";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArchPage } from "@/components/arch";
import { Pixel, PixelDots } from "@/components/pixel";
import { ROVER_A, STATION } from "@/lib/config";
import { chainOfSale, checkPayment, loadSales, type PaymentCheck, type Sales } from "@/lib/station";

const PAGE = 10;
const WHAT: Record<string, string> = { reading: "climate, light + motion", motion: "motion count", history: "history" };

const when = (ts: string) => new Date(Number(ts.split(".")[0]) * 1000)
  .toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const short = (s: string, n = 6) => (s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

function Out({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="underline decoration-accent underline-offset-4 hover:text-accent">{children}</a>;
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="font-dots text-4xl text-chalk">{value}</span>
      <span className="font-label text-xs uppercase tracking-[0.2em] text-chalk-2">{label}</span>
    </p>
  );
}

function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p className={`inline-flex items-center gap-3 border px-4 py-3 font-label text-xs uppercase tracking-[0.14em] ${ok ? "border-good-night text-good-night" : "border-bad text-bad"}`}>
      <Pixel name={ok ? "check" : "cross"} size={18} />{children}
    </p>
  );
}

export function Station() {
  const [data, setData] = useState<Sales | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [checks, setChecks] = useState<Record<string, PaymentCheck>>({});

  useEffect(() => {
    loadSales().then(setData).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  const shown = useMemo(() => data?.sales.slice(page * PAGE, page * PAGE + PAGE) ?? [], [data, page]);
  useEffect(() => {
    for (const s of shown) {
      if (checks[s.tx]) continue;
      checkPayment(s).then((c) => setChecks((m) => ({ ...m, [s.tx]: c })));
    }
  }, [shown, checks]);

  const sales = data?.sales ?? [];
  const earned = sales.reduce((a, s) => a + BigInt(s.amount), BigInt(0));
  const payers = new Set(sales.map((s) => s.payer)).size;
  const pages = Math.max(1, Math.ceil(sales.length / PAGE));

  return (
    <ArchPage>
      <header className="pb-8">
        <nav className="flex flex-wrap items-center justify-between gap-4 py-4 font-label text-xs uppercase tracking-widest text-chalk-2">
          <Link href="/" className="hover:text-accent">‹ Rover for Hire</Link>
          <Link href="/architecture/station/" className="hover:text-accent">How it works ›</Link>
        </nav>
        <div className="flex flex-wrap items-end gap-6 pt-6">
          <Pixel name="station" size={72} className="text-chalk" />
          <div>
            <p className="font-pixel text-5xl leading-none sm:text-7xl">STATION<span className="text-accent">/</span>A</p>
            <p className="mt-4 font-label text-sm uppercase tracking-[0.3em] text-chalk-2">Signed sensor readings for hire</p>
          </div>
        </div>
        <p className="mt-8 max-w-3xl text-lg leading-relaxed">
          The rover isn&apos;t the only machine on this marketplace. Station-A is a second Arduino UNO Q with a climate sensor, a light sensor
          and a motion sensor. An AI agent finds it on Hedera&apos;s ERC-8004 registry, pays 0.001 USDC for a reading with x402 on Hedera, Base or Solana, and gets the reading
          signed by the station&apos;s own key. <span className="text-chalk-2">Every sale goes on a public Hedera topic. This page reads that topic
          and checks it in your browser.</span>
        </p>
      </header>

      <section className="border-t border-night-rule py-10">
        <p className="font-label text-xs uppercase tracking-[0.3em] text-chalk-2">Sales so far</p>
        {!data && !error && <p className="mt-4 font-label text-xs uppercase tracking-[0.2em] text-chalk-2">Reading the Hedera mirror node <PixelDots /></p>}
        {error && <p className="mt-4 text-bad">Couldn&apos;t read the mirror node: {error}</p>}
        {data && (
          <>
            <div className="mt-4 flex flex-wrap items-baseline gap-x-10 gap-y-3">
              <Fact value={String(sales.length)} label="sales" />
              <Fact value={usdcString(earned)} label="USDC earned" />
              <Fact value={String(payers)} label={payers === 1 ? "buyer" : "buyers"} />
            </div>
            <div className="mt-6">
              {data.chain.ok
                ? <Verdict ok>All {sales.length} sales link up: each one carries the hash of the one before</Verdict>
                : <Verdict ok={false}>The chain of sales breaks at message {data.chain.brokenAt}</Verdict>}
            </div>
          </>
        )}
      </section>

      {data && sales.length > 0 && (
        <section className="border-t border-night-rule py-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-label text-xs uppercase tracking-[0.3em] text-chalk-2">Every sale, newest first</p>
              <p className="mt-2 max-w-3xl text-chalk-2">Each payment is looked up on the chain that paid it, Hedera, Base or Solana: it must have settled and paid Station-A exactly the price.</p>
            </div>
            {pages > 1 && (
              <div className="flex items-center gap-3 font-label text-xs uppercase tracking-widest">
                <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="border border-night-rule px-3 py-1.5 enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-30">‹ Newer</button>
                <span className="text-chalk-2">{page + 1} / {pages}</span>
                <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="border border-night-rule px-3 py-1.5 enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-30">Older ›</button>
              </div>
            )}
          </div>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left font-mono text-sm">
              <thead>
                <tr className="font-label text-[11px] uppercase tracking-[0.18em] text-chalk-2">
                  {["#", "When", "What", "USDC", "Buyer", "Payment", "Reading hash"].map((h) => <th key={h} className="border-b border-night-rule py-2 pr-4 font-normal">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const c = checks[s.tx];
                  return (
                    <tr key={s.n} className="border-b border-night-rule/60 align-top">
                      <td className="py-3 pr-4 text-chalk-2">{s.n}</td>
                      <td className="py-3 pr-4 whitespace-nowrap">{when(s.ts)}</td>
                      <td className="py-3 pr-4"><span className="inline-block h-2 w-2 bg-sun align-middle" aria-hidden /> {WHAT[s.type] ?? s.type}</td>
                      <td className="py-3 pr-4">{usdcString(s.amount)}</td>
                      <td className="py-3 pr-4"><Out href={chainOfSale(s).account(s.payer)}>{short(s.payer, 8)}</Out></td>
                      <td className="py-3 pr-4 whitespace-nowrap">
                        {!c ? <span className="text-chalk-2">checking <PixelDots /></span>
                          : <span className={`inline-flex items-center gap-2 ${c.ok ? "text-good-night" : "text-bad"}`}>
                            <Pixel name={c.ok ? "check" : "cross"} size={14} />
                            <Out href={c.link}>{c.ok ? "settled" : "not settled"}</Out>
                            {c.why && <span className="text-chalk-2">{c.why}</span>}
                            <span className="text-chalk-2">on {chainOfSale(s).label} · {s.facilitator}</span>
                          </span>}
                      </td>
                      <td className="py-3 pr-4 text-chalk-2" title={s.readingHash ?? ""}>{s.readingHash ? short(s.readingHash, 8) : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-chalk-2">
            The reading itself goes only to the buyer; the topic keeps its sha256. A buyer can hash the reading it received and find it here.
          </p>
        </section>
      )}

      <section className="border-t border-night-rule py-10">
        <p className="font-label text-xs uppercase tracking-[0.3em] text-chalk-2">Who it is</p>
        <dl className="mt-6 grid gap-px bg-night-rule sm:grid-cols-2">
          {([
            ["Hedera account", <Out key="a" href={`${HASHSCAN}/account/${STATION.account}`}>{STATION.account}</Out>],
            ["Sales topic", <Out key="t" href={`${HASHSCAN}/topic/${STATION.topic}`}>{STATION.topic}</Out>],
            ["ERC-8004 agent", `#${STATION.agentId}, next to Rover-A #${ROVER_A.agentId}`],
            ["Signing key", <span key="k" className="break-all">{STATION.signer}</span>],
            ["Prices", `${STATION.prices.reading} USDC a reading · ${STATION.prices.motion} a motion count · ${STATION.prices.historyPerMin} a minute of history`],
            ["How to buy", "From any AI with our MCP server, on the owner's laptop or remote (rover-for-hire.onrender.com), with find_sensors, buy_sensor_reading and buy_sensor_history; pay on Hedera, Base or Solana"],
          ] as [string, ReactNode][]).map(([k, v]) => (
            <div key={k} className="bg-night p-5">
              <dt className="font-label text-xs uppercase tracking-[0.2em] text-chalk-2">{k}</dt>
              <dd className="mt-2 font-mono text-sm leading-relaxed">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </ArchPage>
  );
}
