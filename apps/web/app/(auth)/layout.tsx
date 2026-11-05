import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { BaseMark } from "@/components/base-mark";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getSessionUserId();
  if (userId) redirect("/dashboard");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <Link href="/" className="mb-8 flex items-center gap-2.5">
        <BaseMark />
        <span className="text-base font-semibold tracking-tight">0xBs</span>
      </Link>
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--shadow-md)]">
        {children}
      </div>
      <p className="mt-6 text-[13px] text-[var(--muted-2)]">
        Secured · Built on Base
      </p>
    </div>
  );
}
