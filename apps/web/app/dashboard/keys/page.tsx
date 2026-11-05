import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@0xBs/db";
import { getSessionUserId } from "@/lib/auth";

export const metadata = { title: "API keys · 0xBs" };

export default async function KeysPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const devices = await prisma.device.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, apiKeyPreview: true },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          API keys
        </h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">
          One key per device. Keys are shown once at creation; only a masked
          reference is kept. Rotate a key from its device page.
        </p>
      </div>

      {devices.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-12 text-center">
          <p className="text-sm text-[var(--muted)]">
            No keys yet — register a device to mint one.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
          {devices.map((d, i) => (
            <Link
              key={d.id}
              href={`/dashboard/devices/${d.id}`}
              className={`group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-[var(--surface-2)] ${
                i > 0 ? "border-t border-[var(--border)]" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--foreground)] group-hover:text-[var(--base-blue)]">
                  {d.title ?? "Untitled device"}
                </p>
                <code className="mt-1 block truncate font-mono text-xs text-[var(--muted)]">
                  {d.apiKeyPreview}
                </code>
              </div>
              <span className="shrink-0 text-[13px] font-medium text-[var(--muted)] group-hover:text-[var(--base-blue)]">
                Manage →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
