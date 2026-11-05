import { redirect } from "next/navigation";
import { prisma } from "@0xBs/db";
import { getSessionUserId } from "@/lib/auth";
import { Card } from "@/components/ui";

export const metadata = { title: "Settings · 0xBs" };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <span className="text-[13px] font-medium text-[var(--muted)]">{label}</span>
      <span className="text-sm text-[var(--foreground)]">{value}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          Settings
        </h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">
          Your account details.
        </p>
      </div>

      <Card className="divide-y divide-[var(--border)]">
        <Row label="Name" value={user.name} />
        <Row label="Email" value={user.email} />
      </Card>
    </div>
  );
}
