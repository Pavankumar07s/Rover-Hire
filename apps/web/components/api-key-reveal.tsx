"use client";

import { Card } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";

/**
 * One-time API key display. The raw key is only available here, right after
 * it's minted — it can never be retrieved again. The user must acknowledge
 * they've copied it to dismiss.
 */
export function ApiKeyReveal({
  apiKey,
  connectorId,
  onDone,
}: {
  apiKey: string;
  connectorId?: string | null;
  onDone: () => void;
}) {
  return (
    <Card className="w-full border-[var(--base-blue)] bg-[var(--base-blue-soft)] p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--base-blue)] text-white">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Copy your API key now
          </h3>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            This is the only time it will be shown. Store it securely — you
            won&rsquo;t be able to see it again.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 font-mono text-sm text-[var(--foreground)]">
          {apiKey}
        </code>
        <CopyButton value={apiKey} label="Copy" className="py-2.5" />
      </div>

      {connectorId && (
        <div className="mt-3">
          <p className="mb-1.5 text-[12px] font-medium text-[var(--muted)]">
            Connector ID (private — flash into firmware)
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 font-mono text-sm text-[var(--foreground)]">
              {connectorId}
            </code>
            <CopyButton value={connectorId} label="Copy" className="py-2.5" />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        className="mt-4 rounded-[var(--radius-sm)] bg-[var(--base-blue)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--base-blue-hover)]"
      >
        I&rsquo;ve saved it
      </button>
    </Card>
  );
}
