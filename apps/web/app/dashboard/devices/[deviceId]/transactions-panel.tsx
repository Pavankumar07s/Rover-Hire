"use client";

import { Card } from "@/components/ui";

export type TransactionItem = {
  id: string;
  hash: string;
  amount: string;
  token: string;
  status: "confirmed" | "pending" | "failed";
  from: string | null;
  createdAt: string;
};

function truncate(value: string, head = 6, tail = 4) {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function StatusPill({ status }: { status: TransactionItem["status"] }) {
  const styles: Record<TransactionItem["status"], string> = {
    confirmed: "bg-[var(--success-soft)] text-[var(--success)] border-[var(--success)]",
    pending: "bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn)]",
    failed: "bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger)]",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium capitalize ${styles[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export function TransactionsPanel({
  transactions,
}: {
  transactions: TransactionItem[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          Transactions
        </h3>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          On-chain payments received on behalf of this device.
        </p>
      </div>

      {transactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-16 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--base-blue-soft)]">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className="text-[var(--base-blue)]"
              aria-hidden="true"
            >
              <path d="M3 12h18M3 6h18M3 18h18" strokeLinecap="round" />
            </svg>
          </div>
          <p className="mt-4 text-sm font-semibold text-[var(--foreground)]">
            No transactions yet
          </p>
          <p className="mt-1.5 max-w-sm text-sm text-[var(--muted)]">
            When this device receives an on-chain payment to its recipient
            wallet, it will appear here.
          </p>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                  <th className="px-4 py-3 text-[13px] font-medium text-[var(--muted)]">
                    Transaction
                  </th>
                  <th className="px-4 py-3 text-[13px] font-medium text-[var(--muted)]">
                    From
                  </th>
                  <th className="px-4 py-3 text-right text-[13px] font-medium text-[var(--muted)]">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-[13px] font-medium text-[var(--muted)]">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-[13px] font-medium text-[var(--muted)]">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-[var(--border)] last:border-0 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <td className="px-4 py-3">
                      <code className="font-mono text-[var(--foreground)]">
                        {truncate(t.hash)}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <code className="font-mono text-[var(--muted)]">
                        {t.from ? truncate(t.from) : "—"}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-[var(--foreground)]">
                      {t.amount} {t.token}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--muted)] tabular-nums">
                      {new Date(t.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
