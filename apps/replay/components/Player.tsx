"use client";

import { chainOfTx, USDC_DECIMALS } from "@0xBs/hedera/browser";
import { useEffect, useRef, useState } from "react";
import { didText, headline, kindOf, pauseText, skillLabel } from "@/lib/describe";
import { time } from "@/lib/util";
import type { Checkpoint } from "@/lib/verify";
import { Heading } from "./chrome";
import { Glyph, Pixel } from "./pixel";
import { Disclosure, Ext, Hash, KIND, KindTag, Status } from "./ui";

const STEP_MS = 1800;

const failed = (c: Checkpoint) => !c.audit.ok || (!!c.payment && !c.payment.paidBeforeUse);

export function Player({ checkpoints, index, onIndex }: { checkpoints: Checkpoint[]; index: number; onIndex: (i: number) => void }) {
  const [playing, setPlaying] = useState(false);
  const n = checkpoints.length;
  const c = checkpoints[index]!;
  const strip = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, summary")) return;
      if (e.key === "ArrowRight") onIndex(Math.min(index + 1, n - 1));
      if (e.key === "ArrowLeft") onIndex(Math.max(index - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, n, onIndex]);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      if (index + 1 >= n - 1) setPlaying(false);
      onIndex(Math.min(index + 1, n - 1));
    }, STEP_MS);
    return () => clearTimeout(t);
  }, [playing, index, n, onIndex]);

  useEffect(() => {
    const el = strip.current?.children[index] as HTMLElement | undefined;
    if (el && strip.current) strip.current.scrollTo({ left: el.offsetLeft - strip.current.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [index]);

  const ctl = "grid h-10 w-10 place-items-center border border-chalk/50 text-chalk hover:bg-chalk hover:text-night disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-chalk";
  return (
    <section>
      <Heading n="07" label="Replay" title="Step through the mission." sub="What the camera showed 0G, what it decided, and what the rover did. Use the ← → keys or the strip." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="min-w-0 bg-night p-3 text-chalk sm:p-4">
          <Frame c={c} />
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => onIndex(Math.max(index - 1, 0))} disabled={index === 0} aria-label="Previous step" className={ctl}><Glyph name="prev" /></button>
            <button onClick={() => { if (index >= n - 1) onIndex(0); setPlaying(!playing); }}
              className="inline-flex h-10 items-center gap-2.5 border border-accent bg-accent px-4 font-label text-xs uppercase tracking-[0.14em] text-night hover:border-chalk hover:bg-chalk">
              <Glyph name={playing ? "stop" : "play"} />{playing ? "Pause" : "Play"}
            </button>
            <button onClick={() => onIndex(Math.min(index + 1, n - 1))} disabled={index === n - 1} aria-label="Next step" className={ctl}><Glyph name="next" /></button>
            <span className="ml-auto font-label text-sm uppercase tracking-[0.12em] text-chalk-2">
              Step <span className="font-dots text-xl text-chalk">{String(index + 1).padStart(2, "0")}</span> / {String(n).padStart(2, "0")}
            </span>
          </div>
          <ol ref={strip} className="mt-3 flex gap-1.5 overflow-x-auto pb-2 [scrollbar-color:#2b2b2b_transparent]" aria-label="Steps">
            {checkpoints.map((x, k) => {
              const kd = KIND[kindOf(x.record)];
              return (
                <li key={x.record.seq} className="shrink-0">
                  <button onClick={() => { setPlaying(false); onIndex(k); }} aria-current={k === index ? "step" : undefined}
                    aria-label={`Step ${k + 1}: ${headline(x.record)}${failed(x) ? " (failed a check)" : ""}`}
                    className={`relative block w-[4.5rem] border-2 ${k === index ? "border-accent" : "border-transparent opacity-55 hover:opacity-100"}`}>
                    <span className={`absolute inset-x-0 top-0 z-10 h-1 ${kd.bar}`} />
                    {/* eslint-disable-next-line @next/next/no-img-element -- a verified frame from the 0G segment */}
                    {x.frame ? <img src={x.frame} alt="" className="aspect-[4/3] w-full object-cover" /> : <span className="block aspect-[4/3] bg-night-2" />}
                    <span className="absolute bottom-0.5 left-0.5 bg-night/85 p-0.5"><Pixel name={kd.icon} size={11} grid={false} className={kd.text} /></span>
                    {failed(x) && <span className="absolute right-0.5 top-1.5 bg-night/85 p-0.5"><Pixel name="cross" size={11} grid={false} className="text-bad" /></span>}
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em] text-chalk-2">
            {(["move", "photo", "pause"] as const).map((k) => {
              const kd = KIND[k];
              return <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-1 w-4 ${kd.bar}`} /><Pixel name={kd.icon} size={11} grid={false} className={kd.text} />{kd.label}</span>;
            })}
            <span className="inline-flex items-center gap-1.5"><Pixel name="cross" size={11} grid={false} className="text-bad" />Failed a check</span>
          </p>
        </div>
        <StepCard c={c} index={index} n={n} />
      </div>
    </section>
  );
}

function Frame({ c }: { c: Checkpoint }) {
  const t = c.record.decision?.target;
  return (
    <div className="relative overflow-hidden bg-night-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the verified segment, nothing to optimise */}
      {c.frame ? <img src={c.frame} alt={`What the camera showed 0G at step ${c.record.seq + 1}`} className="block w-full" />
        : <div className="grid aspect-[4/3] place-items-center font-pixel text-chalk-2">Frame missing</div>}
      {t && t.length === 4 && (
        <div className="pointer-events-none absolute border-2 border-dashed border-accent"
          style={{ left: `${t[0]! / 10}%`, top: `${t[1]! / 10}%`, width: `${(t[2]! - t[0]!) / 10}%`, height: `${(t[3]! - t[1]!) / 10}%` }}>
          <span className={`absolute left-0 whitespace-nowrap bg-accent px-1.5 py-0.5 font-label text-[11px] uppercase tracking-[0.12em] text-night ${t[1]! < 80 ? "top-0" : "-top-6"}`}>0G target</span>
        </div>
      )}
    </div>
  );
}

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-2">{k}</dt>
      <dd className="mt-1 leading-relaxed">{children}</dd>
    </div>
  );
}

function StepCard({ c, index, n }: { c: Checkpoint; index: number; n: number }) {
  const r = c.record;
  const d = r.decision;
  const did = didText(r.executed);
  const sig = c.audit.signature;
  const photo = r.photo as { n: number; sha256: string } | null;
  const paid = c.payment?.ledger?.usdc.filter((u) => u.amount > 0) ?? [];
  const sensors = (() => { try { return JSON.parse(r.sensors_json as string); } catch { return {}; } })();
  return (
    <div className="border border-ink p-5" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <KindTag kind={kindOf(r)} />
        <span className="font-mono text-xs text-ink-2">Step {index + 1} of {n} · {time(r.t_reply_ms as number)}</span>
      </div>
      <h3 className="mt-4 font-pixel text-2xl leading-tight">{headline(r)}</h3>

      {r.safe_stop && (
        <p className="mt-4 flex gap-3 bg-paper-2 p-3 text-sm leading-relaxed"><Pixel name="pause" size={16} grid={false} className="mt-0.5 text-pause" />{pauseText(r.safe_stop)}</p>
      )}

      <dl className="mt-5 space-y-4 text-sm">
        {d && <>
          <Field k="0G saw">“{d.see}”</Field>
          <Field k="0G chose"><span className="font-semibold">{skillLabel(d.skill)}</span>{d.reason ? <span className="text-ink-2"> because “{d.reason}”</span> : null}</Field>
        </>}
        {did && <Field k="The rover">{did}</Field>}
      </dl>

      <ul className="mt-5 space-y-2.5 border-t border-ink pt-4 text-sm">
        <li>{sig ? <Status ok={sig.verified && c.audit.claim}>{sig.verified ? "Signed inside 0G's TEE" : `TEE signature does not check out (${sig.reason})`}</Status>
          : <span className="text-ink-2">No AI decision to sign at this step</span>}</li>
        <li>{r.money_tx ? (
          c.payment === undefined ? <Status ok={null}>Looking up the payment on {chainOfTx(r.money_tx as string)?.label ?? "its chain"}…</Status>
            : c.payment?.ledger ? (
              <Status ok={c.payment.paidBeforeUse}>
                Paid {paid.map((u) => `${Number(u.amount) / 10 ** USDC_DECIMALS} USDC`).join(" + ")}, settled{" "}
                {((r.t_reply_ms as number) / 1000 - c.payment.ledger.at).toFixed(1)} s before the rover acted
                {c.payment.ledger.chain.chain === "hedera" ? "" : ` (${c.payment.ledger.chain.label})`}.{" "}
                <Ext href={c.payment.ledger.link}>{c.payment.ledger.chain.explorer}</Ext>
              </Status>
            ) : <Status ok={false}>Payment not found on {chainOfTx(r.money_tx as string)?.label ?? "any chain we pay on"}{c.payment?.error ? ` (${c.payment.error})` : ""}</Status>
        ) : <span className="text-ink-2">No payment: the rover did not move at this step</span>}</li>
        {r.number_check && <li>{c.audit.numberCheck
          ? <Status ok={c.audit.numberCheck.verified}>{r.number_check.ok
              ? `Number check: 0G read “${r.number_check.number}” on a close-up of the box, signed in its TEE`
              : `Number check: 0G read ${r.number_check.number ? `“${r.number_check.number}”` : "no number"} on a close-up of the box, so no photo`}</Status>
          : <span className="text-ink-2">Number check did not complete, so no photo</span>}</li>}
        <li><Status ok={c.audit.hash && c.audit.link && c.audit.image}>Step record intact (fingerprint, link and frame)</Status></li>
        {photo && <li className="text-ink-2">Delivered photo {photo.n}, sha256 <Hash value={photo.sha256} n={8} /></li>}
      </ul>

      <Disclosure className="mt-5" summary="Technical details">
        <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-ink-2">Sensors</dt><dd>sonar {sensors.sonar_cm ?? "–"} cm · heading {sensors.yaw_deg ?? "–"}° · battery {sensors.battery_v ?? "–"} V</dd>
          <dt className="text-ink-2">Model</dt><dd>{r.model as string} · {r.latency_ms as number} ms</dd>
          <dt className="text-ink-2">0G request</dt><dd>{r.request_id ? <Hash value={r.request_id as string} n={8} /> : "none: the request to 0G failed, nothing was paid or moved"}</dd>
          {r.safe_stop && <><dt className="text-ink-2">Pause code</dt><dd>{r.safe_stop.reason} {r.safe_stop.detail}</dd></>}
          {r.money_tx ? <><dt className="text-ink-2">Payment tx</dt><dd className="break-all">{r.money_tx as string} (move {r.move_index as number})</dd></> : null}
          {sig?.signer && <><dt className="text-ink-2">TEE signer</dt><dd><Hash value={sig.signer} n={6} /></dd></>}
          <dt className="text-ink-2">Step hash</dt><dd><Hash value={r.hash} n={10} /></dd>
          <dt className="text-ink-2">Previous hash</dt><dd><Hash value={r.prev_hash} n={10} /></dd>
          <dt className="text-ink-2">Frame sha256</dt><dd><Hash value={r.img_sha256} n={10} /></dd>
          <dt className="text-ink-2">Segment</dt><dd>{c.segIndex}</dd>
        </dl>
      </Disclosure>
    </div>
  );
}
