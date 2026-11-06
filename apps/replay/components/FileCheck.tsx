"use client";

import type { TeeService } from "@0xBs/zg/browser";
import { useState } from "react";
import type { Episode } from "@/lib/episodes";
import { checkFile } from "@/lib/verify";
import { Hash, Status } from "./ui";

type Result = Awaited<ReturnType<typeof checkFile>>;

/** Anyone can download a segment, change a byte, and drop it here: only the edited record fails. */
export function FileCheck({ ep, tee, prevHashOf }: { ep: Episode; tee: TeeService; prevHashOf: (segIndex: number) => string }) {
  const [res, setRes] = useState<Result | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setName(f.name);
    try {
      setRes(await checkFile(new Uint8Array(await f.arrayBuffer()), ep, tee, prevHashOf));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-dashed border-ink p-5">
      <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
        Download a segment from the list above, edit it if you like (change one letter of a decision), and choose it here.
        Its 0G root is recomputed and every record is checked again against this episode&apos;s anchors.
      </p>
      <label className="mt-5 inline-flex cursor-pointer items-center gap-2.5 border border-ink bg-accent px-4 py-3 font-label text-xs uppercase tracking-[0.14em] text-night hover:bg-ink hover:text-paper">
        <span className="h-1.5 w-1.5 bg-current" aria-hidden />{busy ? "Checking…" : "Choose a segment file"}
        <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {res && (
        <div className="mt-4 text-sm">
          <p className="font-label">{name}</p>
          {res.error ? <p className="mt-2"><Status ok={false}>{res.error}</Status></p> : <>
            <p className="mt-2"><Status ok={res.rootOk}>0G root <Hash value={res.root} n={6} />{" "}
              {res.rootOk ? `equals segment ${res.anchor!.segIndex}'s anchored root` : <>differs from segment {res.anchor!.segIndex}&apos;s anchored root <Hash value={res.anchor!.root} n={6} /></>}</Status></p>
            {res.audit?.header && <p className="mt-1">{res.audit.header}</p>}
            <ul className="mt-3 grid gap-1 sm:grid-cols-2">
              {res.audit?.records.map((r) => (
                <li key={r.seq}>
                  <Status ok={r.ok}>Step <span className="font-mono">{r.seq + 1}</span>
                    {!r.ok && <span>
                      : {[!r.hash && "fingerprint does not recompute", !r.link && "broken link", !r.image && "frame changed", !r.claim && "signature"].filter(Boolean).join(", ")}
                    </span>}
                  </Status>
                </li>
              ))}
            </ul>
          </>}
        </div>
      )}
    </div>
  );
}
