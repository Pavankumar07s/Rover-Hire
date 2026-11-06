"use client";

import { USDC_DECIMALS } from "@0xBs/hedera/browser";
import { GALILEO, GENESIS, MAINNET } from "@0xBs/zg/browser";
import { useEffect, useMemo, useRef, useState, type MouseEventHandler, type ReactNode } from "react";
import { DEFAULT_ROVER, MAINNET_EXPLORER } from "@/lib/config";
import type { Episode } from "@/lib/episodes";
import type { PixelName } from "@/lib/pixels";
import { short, time } from "@/lib/util";
import { verifyEpisode, type Verification } from "@/lib/verify";
import { Heading, Index } from "./chrome";
import { FileCheck } from "./FileCheck";
import { Pixel, PixelLoader } from "./pixel";
import { Player } from "./Player";
import { Disclosure, Ext, Hash, Status } from "./ui";

export function EpisodeView({ ep, rover, homeHref, onHome }: { ep: Episode; rover: string; homeHref: string; onHome: MouseEventHandler<HTMLAnchorElement> }) {
  const [v, setV] = useState<Verification | null>(null);
  const [step, setStep] = useState(0);
  const playerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    verifyEpisode(ep, setV, ac.signal);
    return () => ac.abort();
  }, [ep]);

  const s = useMemo(() => summarise(ep, v), [ep, v]);
  const cps = v?.checkpoints ?? [];
  const prevHashOf = (segIndex: number): string => {
    const first = ep.segments.find((a) => a.segIndex === segIndex)?.firstSeq ?? 0;
    return cps.find((c) => c.record.seq === first - 1)?.record.hash ?? GENESIS;
  };
  const show = (i: number) => { setStep(i); playerRef.current?.scrollIntoView({ block: "start" }); };
  const mmss = s.ms ? `${Math.floor(s.ms / 60000)}:${String(Math.round(s.ms / 1000) % 60).padStart(2, "0")}` : "–";

  return (
    <article>
      <header className="bg-night text-chalk">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-chalk-2">
              <a href={homeHref} onClick={onHome} className="hover:text-chalk">Missions</a> / {ep.id}
            </p>
            <h1 className="mt-5 font-pixel text-4xl leading-tight sm:text-6xl">{ep.mission || "Mission"}</h1>
            <p className="mt-4 font-mono text-sm text-chalk-2">
              {time(ep.startedAt)} · {rover === DEFAULT_ROVER ? "Rover-A" : short(rover)}{ep.photosWanted ? ` · ${ep.photosWanted} photos ordered` : ""}
            </p>
          </div>
          <Verdict s={s} />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <dl className="grid grid-cols-2 gap-px border-b border-rule bg-rule lg:grid-cols-4">
          <Stat n="01" label="Photos" icon="camera" value={v ? `${s.photos.length}` : "–"} sub={ep.photosWanted ? `of ${ep.photosWanted} ordered` : "delivered"} />
          <Stat n="02" label="Decisions" icon="lock" value={v ? `${s.decisions}` : "–"} sub="signed inside a 0G TEE" />
          <Stat n="03" label="Paid" icon="coin" value={v ? `${s.moves}` : "–"} sub={s.usdc !== null ? `moves · ${s.usdc} USDC` : "moves · checking payments"} />
          <Stat n="04" label="Time" icon="clock" value={mmss} sub={v ? `${s.records} steps` : "minutes"} />
        </dl>

        <section className="pt-20">
          <Heading n="05" label="Proof" title="Checked in your browser, just now." sub="Nothing here comes from a server of ours: each check reads 0G and the chain that paid directly." />
          <ul className="border-t border-ink">
            <ProofRow icon="storage" title="Stored on 0G Storage" detail={`${s.segmentsOk} of ${ep.segments.length} segments: roots recomputed here equal the roots anchored on Galileo`} ok={s.checks.storage} />
            <ProofRow icon="lock" title="Decided inside 0G's TEE" detail={`${s.sigOk} of ${s.signed} decisions carry a signature from the enclave key 0G registers on mainnet`} ok={s.checks.tee} />
            <ProofRow icon="coin" title={`Paid${s.paidOn ? ` on ${s.paidOn}` : ""} before each move`} detail={`${s.paidOk} of ${s.moves} moves settled in USDC before the rover acted`} ok={s.checks.hedera} />
            <ProofRow icon="chain" title="Record chain unbroken" detail={`${s.chainOk} of ${s.records} steps: fingerprint, link and camera frame recompute`} ok={s.checks.chain} />
          </ul>
          <Disclosure className="mt-8" summary="How is each check done?">
            <ul className="grid gap-px border border-rule bg-rule text-sm sm:grid-cols-2">
              <How ok={s.checks.started} title="Started on chain">
                The rover <Hash value={rover} n={4} /> opened this mission in the EpisodeLog contract on 0G Galileo, and its id hashes to the on-chain key.{" "}
                <Ext href={`${GALILEO.explorer}/tx/${ep.startTx}`}>Start tx</Ext>
              </How>
              <How ok={s.checks.storage} title="Stored on 0G Storage">
                Each segment is downloaded and its 0G root recomputed in this tab. It must equal the anchored root, so the storage server is not trusted either.
              </How>
              <How ok={s.checks.chain} title="Record chain">
                Each step&apos;s sha256, its link to the step before and its camera frame are recomputed. One changed byte breaks that step.
              </How>
              <How ok={s.checks.tee} title="0G TEE signature">
                Each answer&apos;s signature must recover to {v?.tee ? <Hash value={v.tee.signerOnchain} n={4} /> : "the signer"}, the TEE key 0G&apos;s serving
                contract lists for this provider, read live from 0G mainnet. <Ext href={`${MAINNET_EXPLORER}/address/${MAINNET.inferenceServing}`}>Serving contract</Ext>
                {v?.teeError && <span className="mt-1 block">Could not read it: {v.teeError}</span>}
              </How>
              <How ok={s.checks.hedera} title="Payment">
                Each move&apos;s payment is looked up on the chain that settled it (Hedera&apos;s mirror node, Base Sepolia or Solana devnet): it must have
                succeeded, paid USDC, and settled before the rover acted.
              </How>
              <How ok={s.checks.ended} title="Ended on chain">
                {ep.ended ? <>The closing record&apos;s final root and counts ({ep.ended.decisions} decisions, {ep.ended.safeStops} pauses) match the steps.{" "}
                  <Ext href={`${GALILEO.explorer}/tx/${ep.ended.tx}`}>End tx</Ext></> : "This mission was never closed on chain."}
              </How>
            </ul>
          </Disclosure>
        </section>

        {!v || !cps.length ? <PixelLoader label="Downloading the mission from 0G Storage" /> : <>
          {s.photos.length > 0 && (
            <section className="pt-20">
              <Heading n="06" label="Photos" title="What the rover delivered." sub="The camera view at the moment 0G decided to take each photo. Select one to jump to it in the replay." />
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {s.photos.map(({ n, index }) => (
                  <li key={n}>
                    <button onClick={() => show(index)} className="group block w-full text-left">
                      <span className="block border border-ink p-1 group-hover:border-accent group-hover:bg-accent">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a verified frame from the 0G segment */}
                        <img src={cps[index]!.frame ?? ""} alt={`Photo ${n}`} className="aspect-[4/3] w-full object-cover" />
                      </span>
                      <span className="mt-2 flex items-center justify-between font-label text-xs uppercase tracking-[0.14em]">
                        <span className="inline-flex items-center gap-2"><Pixel name="camera" size={14} grid={false} className="text-photo" />Photo {String(n).padStart(2, "0")}</span>
                        <span className="font-mono normal-case tracking-normal text-ink-2">step {cps[index]!.record.seq + 1}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div ref={playerRef} className="scroll-mt-20 pt-20">
            <Player checkpoints={cps} index={Math.min(step, cps.length - 1)} onIndex={setStep} />
          </div>
        </>}

        <section className="pb-24 pt-20">
          <Heading n="08" label="For auditors" title="The raw records, and a tamper test." sub="Download any segment from 0G Storage, change one byte, and drop it back in: only the step you changed fails." />
          <div className="space-y-6">
            <Disclosure summary="Segments on 0G Storage"><Segments v={v} ep={ep} /></Disclosure>
            {v?.tee && v.done && <div><Disclosure summary="Check a segment file yourself"><FileCheck ep={ep} tee={v.tee} prevHashOf={prevHashOf} /></Disclosure></div>}
          </div>
        </section>
      </div>
    </article>
  );
}

type Summary = ReturnType<typeof summarise>;

function summarise(ep: Episode, v: Verification | null) {
  const cps = v?.checkpoints ?? [];
  const segs = v?.segments ?? [];
  const moves = cps.filter((c) => c.payment !== null);
  const paymentsIn = moves.every((c) => c.payment !== undefined);
  const atomic = moves.reduce((a, c) => a + (c.payment?.ledger?.usdc.filter((u) => u.amount > 0).reduce((x, u) => x + Number(u.amount), 0) ?? 0), 0);
  const first = cps[0]?.record;
  const last = cps.at(-1)?.record;
  const segmentsIn = segs.length > 0 && segs.every((x) => x.rootOk !== null || x.error);
  const checks = {
    started: ep.idMatches,
    storage: segmentsIn ? segs.every((x) => x.rootOk && x.eventOk && x.audit?.header === null) : null,
    chain: segmentsIn ? cps.every((c) => c.audit.hash && c.audit.link && c.audit.image) : null,
    tee: v?.teeError ? false : segmentsIn ? cps.every((c) => c.audit.claim && (!c.audit.signature || c.audit.signature.verified)) : null,
    hedera: moves.length === 0 ? null : paymentsIn ? moves.every((c) => c.payment?.paidBeforeUse) : null,
    ended: ep.ended ? v?.endOk ?? null : false,
  };
  return {
    records: cps.length,
    photos: cps.flatMap((c, index) => (c.record.photo ? [{ n: (c.record.photo as { n: number }).n, index }] : [])),
    decisions: cps.filter((c) => c.record.decision).length,
    signed: cps.filter((c) => c.audit.signature).length,
    sigOk: cps.filter((c) => c.audit.signature?.verified && c.audit.claim).length,
    moves: moves.length,
    paidOk: moves.filter((c) => c.payment?.paidBeforeUse).length,
    // the chain(s) the moves were paid on, as read from each payment itself
    paidOn: [...new Set(moves.flatMap((c) => (c.payment?.ledger ? [c.payment.ledger.chain.chain === "hedera" ? "Hedera" : c.payment.ledger.chain.label] : [])))]
      .join(" and ") || null,
    usdc: paymentsIn && v ? (atomic / 10 ** USDC_DECIMALS).toString() : null,
    ms: first && last ? (last.t_reply_ms as number) - (first.t_frame_ms as number) : 0,
    segmentsOk: segs.filter((x) => x.rootOk && x.eventOk && x.audit?.header === null).length,
    chainOk: cps.filter((c) => c.audit.hash && c.audit.link && c.audit.image).length,
    checks,
    done: !!v?.done,
    failed: Object.values(checks).filter((x) => x === false).length,
  };
}

function Verdict({ s }: { s: Summary }) {
  const verified = s.done && s.failed === 0;
  const [icon, tone, title, sub]: [PixelName, string, string, string] = !s.done
    ? ["shield", "text-chalk-2", "Verifying", `${s.records} steps checked so far`]
    : verified ? ["shield", "text-good-night", "Verified", "every proof checks out"]
    : ["cross", "text-bad", `${s.failed} failed`, "see the ✗ marks below"];
  return (
    <div className={`flex items-center gap-4 border px-5 py-4 ${verified ? "border-good-night/60" : s.done ? "border-bad" : "border-night-rule"}`} role="status" aria-live="polite">
      <Pixel name={icon} size={44} className={tone} />
      <div>
        <p className={`font-pixel text-2xl uppercase tracking-[0.08em] ${s.done ? "" : "animate-pulse"}`}>{title}</p>
        <p className="font-mono text-xs text-chalk-2">{sub}</p>
      </div>
    </div>
  );
}

function Stat({ n, label, icon, value, sub }: { n: string; label: string; icon: PixelName; value: string; sub: string }) {
  return (
    <div className="bg-paper px-1 py-8 sm:px-6">
      <dt><Index n={n} label={label} /></dt>
      <dd>
        <Pixel name={icon} size={40} className="mt-5 text-ink" />
        <p className="mt-4 font-dots text-6xl leading-none sm:text-7xl">{value}</p>
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-2">{sub}</p>
      </dd>
    </div>
  );
}

function ProofRow({ icon, title, detail, ok }: { icon: PixelName; title: string; detail: string; ok: boolean | null }) {
  return (
    <li className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2 border-b border-rule py-5 sm:grid-cols-[auto_1fr_auto]">
      <Pixel name={icon} size={36} className="text-ink" />
      <div>
        <p className="font-pixel text-xl">{title}</p>
        <p className="mt-1 text-sm text-ink-2">{detail}</p>
      </div>
      <p className="col-start-2 font-label text-xs uppercase tracking-[0.14em] sm:col-start-3"><Status ok={ok}>{ok === true ? "Verified" : ok === false ? "Failed" : "Checking"}</Status></p>
    </li>
  );
}

function How({ ok, title, children }: { ok: boolean | null; title: string; children: ReactNode }) {
  return (
    <li className="bg-paper p-5">
      <p className="flex items-center justify-between gap-2 font-label text-sm uppercase tracking-[0.12em]">{title}<Status ok={ok} /></p>
      <p className="mt-2 leading-relaxed text-ink-2">{children}</p>
    </li>
  );
}

function Segments({ v, ep }: { v: Verification | null; ep: Episode }) {
  const rows = v?.segments ?? ep.segments.map((a) => ({ ...a, bytes: null, rootOk: null, eventOk: null, audit: null, error: null }));
  return (
    <div className="overflow-x-auto border border-ink">
      <table className="w-full min-w-[680px] text-sm">
        <thead className="bg-ink text-left font-label text-xs uppercase tracking-[0.12em] text-paper">
          <tr><th className="px-4 py-3">Segment</th><th className="px-4 py-3">Steps</th><th className="px-4 py-3">0G root</th><th className="px-4 py-3">Size</th>
            <th className="px-4 py-3">Root = anchor</th><th className="px-4 py-3">Steps verify</th><th className="px-4 py-3">Anchor</th></tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.segIndex} className="border-t border-rule">
              <td className="px-4 py-3">{x.segIndex}</td>
              <td className="px-4 py-3">{x.firstSeq + 1}–{x.lastSeq + 1}</td>
              <td className="px-4 py-3"><Ext href={`${GALILEO.indexer}/file?root=${x.root}&name=segment_${x.segIndex}.json`}><Hash value={x.root} n={5} /></Ext></td>
              <td className="px-4 py-3 text-ink-2">{x.bytes ? `${Math.round(x.bytes / 1024)} KB` : "–"}</td>
              <td className="px-4 py-3"><Status ok={x.error ? false : x.rootOk === null ? null : !!(x.rootOk && x.eventOk)}>{x.error ?? undefined}</Status></td>
              <td className="px-4 py-3"><Status ok={x.error ? false : x.audit ? x.audit.ok : null}>{x.audit?.header ?? undefined}</Status></td>
              <td className="px-4 py-3"><Ext href={`${GALILEO.explorer}/tx/${x.tx}`}>tx</Ext></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
