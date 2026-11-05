"use client";

import { useState } from "react";

export function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--muted)] transition-colors hover:border-[var(--base-blue)] hover:text-[var(--base-blue)] ${
        copied ? "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]" : ""
      } ${className}`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
