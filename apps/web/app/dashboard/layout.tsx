import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@0xBs/db";
import { getSessionUserId } from "@/lib/auth";
import { BaseMark } from "@/components/base-mark";
import { CopyButton } from "@/components/copy-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProfileMenu } from "./profile-menu";
import { SidebarNav } from "./sidebar-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  if (!user) redirect("/login");

  const deviceCount = await prisma.device.count({ where: { userId } });

  return (
    <div className="flex min-h-dvh">
      {/* Left sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] md:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-[var(--border)] px-5">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <BaseMark />
            <span className="text-base font-semibold tracking-tight">0xBs</span>
          </Link>
        </div>

        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-[13px] font-medium text-[var(--muted-2)]">
            Workspace
          </span>
          <span className="rounded-full bg-[var(--base-blue-soft)] px-2 py-0.5 text-[12px] font-medium text-[var(--base-blue)]">
            {deviceCount} {deviceCount === 1 ? "device" : "devices"}
          </span>
        </div>

        <div className="px-3 py-1">
          <SidebarNav />
        </div>

        <div className="mt-auto border-t border-[var(--border)] p-4">
          <ProfileMenu userId={userId} name={user.name} email={user.email} />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_85%,transparent)] px-6 backdrop-blur-sm">
          {/* Mobile logo (sidebar is hidden on small screens) */}
          <Link href="/dashboard" className="flex items-center gap-2.5 md:hidden">
            <BaseMark />
            <span className="text-base font-semibold tracking-tight">0xBs</span>
          </Link>
          <span className="hidden text-sm font-medium text-[var(--foreground)] md:block">
            Dashboard
          </span>
          <div className="flex items-center gap-2.5">
            <span className="hidden text-[13px] text-[var(--muted-2)] sm:inline">
              User ID
            </span>
            <code className="max-w-[200px] truncate rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-xs text-[var(--muted)]">
              {userId}
            </code>
            <CopyButton value={userId} label="Copy" />
            <ThemeToggle />
          </div>
        </header>
        <main className="w-full flex-1 px-6 py-8">
          <div className="mx-auto w-full max-w-4xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
