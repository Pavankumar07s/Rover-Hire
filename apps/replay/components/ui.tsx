import type { ReactNode } from "react";
import type { Kind } from "@/lib/describe";
import type { PixelName } from "@/lib/pixels";
import { Glyph, Pixel } from "./pixel";

/** Verification state: a pixel mark plus a word, never colour alone. */
export function Status({ ok, children, night = false }: { ok: boolean | null | undefined; children?: ReactNode; night?: boolean }) {
  const [name, cls, word] = ok === true ? ["check", night ? "text-good-night" : "text-good", "verified"] as const
    : ok === false ? ["cross", "text-bad", "failed"] as const : [null, "", "checking"] as const;
  return (
    <span className="inline-flex items-start gap-2">
      {name ? <Pixel name={name} size={16} grid={false} className={`mt-[0.1em] ${cls}`} label={word} />
        : <span className="mt-[0.3em] h-3 w-3 shrink-0 animate-pulse bg-current opacity-30" role="img" aria-label={word} />}
      {children !== undefined && <span>{children}</span>}
    </span>
  );
}

export const KIND: Record<Kind, { label: string; icon: PixelName; bar: string; text: string }> = {
  move: { label: "Move", icon: "move", bar: "bg-move", text: "text-move" },
  photo: { label: "Photo", icon: "camera", bar: "bg-photo", text: "text-photo" },
  pause: { label: "Paused", icon: "pause", bar: "bg-pause", text: "text-pause" },
};

export function KindTag({ kind }: { kind: Kind }) {
  const k = KIND[kind];
  return (
    <span className="inline-flex items-center gap-2 border border-ink px-2.5 py-1 font-label text-xs uppercase tracking-[0.14em]">
      <Pixel name={k.icon} size={14} grid={false} className={k.text} />{k.label}
    </span>
  );
}

export function Ext({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className={`inline-flex items-center gap-1.5 underline decoration-accent decoration-2 underline-offset-4 hover:bg-accent hover:text-night ${className}`}>
      {children}<Glyph name="ext" />
    </a>
  );
}

export function Hash({ value, n = 6 }: { value: string; n?: number }) {
  const s = value.length > 2 * n + 5 ? `${value.slice(0, n + 2)}…${value.slice(-n)}` : value;
  return <code className="font-mono text-[0.9em]" title={value}>{s}</code>;
}

export function Disclosure({ summary, children, className = "" }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={className}>
      <summary className="inline-flex cursor-pointer select-none items-center gap-2 border-b-2 border-accent pb-0.5 font-label text-sm uppercase tracking-[0.12em] hover:bg-accent hover:text-night">
        {summary}<Glyph name="down" className="chevron transition-transform" />
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
