"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { apiUrl } from "@/lib/base-path";

type ProfileMenuProps = {
  userId: string;
  name: string;
  email: string;
};

export function ProfileMenu({ userId, name, email }: ProfileMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function logout() {
    setLoading(true);
    await fetch(apiUrl("/api/auth/logout"), { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[var(--shadow-lg)]">
          <Button
            variant="danger"
            loading={loading}
            onClick={logout}
            className="w-full"
          >
            Log out
          </Button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-2)]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--base-blue)] text-xs font-semibold uppercase text-white">
          {name.slice(0, 2)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-tight text-[var(--foreground)]">
            {name}
          </p>
          <p className="truncate text-[12px] text-[var(--muted)]">{email}</p>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`ml-auto shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
