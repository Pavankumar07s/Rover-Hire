import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@0xBs/db";
import { getSessionUserId } from "@/lib/auth";
import { CreateDevice } from "./create-device";

export const metadata = { title: "Dashboard · 0xBs" };

export default async function DashboardPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const devices = await prisma.device.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      apiKeyPreview: true,
      createdAt: true,
      _count: { select: { services: true } },
    },
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
            Devices
          </h1>
          <p className="mt-1.5 text-sm text-[var(--muted)]">
            {devices.length === 0
              ? "No devices registered yet."
              : `${devices.length} device${devices.length === 1 ? "" : "s"} registered.`}
          </p>
        </div>
        <CreateDevice />
      </div>

      {devices.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-12 text-center">
          <p className="text-sm text-[var(--muted)]">
            Devices you register will appear here, each with its own API key.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {devices.map((d) => (
            <li key={d.id}>
              <Link
                href={`/dashboard/devices/${d.id}`}
                className="group block h-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 truncate font-semibold tracking-tight text-[var(--foreground)] group-hover:text-[var(--base-blue)]">
                    {d.title ?? "Untitled device"}
                  </h2>
                  <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--muted)]">
                    {d._count.services} svc
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-[var(--muted)]">
                  {d.description ?? "No description"}
                </p>
                <div className="my-4 h-px bg-[var(--border)]" />
                <div className="flex items-center justify-between gap-2">
                  <code className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 font-mono text-xs text-[var(--muted)]">
                    {d.apiKeyPreview}
                  </code>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
