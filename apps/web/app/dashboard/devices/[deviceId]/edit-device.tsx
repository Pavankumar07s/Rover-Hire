"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Textarea } from "@/components/ui";
import { apiUrl } from "@/lib/base-path";

type DeviceFields = {
  title: string;
  description: string;
};

export function EditDevice({
  deviceId,
  initial,
}: {
  deviceId: string;
  initial: DeviceFields;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape and lock body scroll while the dialog is open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const payload = {
      title: form.get("title") as string,
      description: form.get("description") as string,
    };

    try {
      const res = await fetch(apiUrl(`/api/devices/${deviceId}`), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save changes");
        setLoading(false);
        return;
      }
      setOpen(false);
      setLoading(false);
      router.refresh();
    } catch {
      setError("Network error — please try again");
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Edit
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0a0b0d]/40 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Edit device"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">
                Edit device
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <form onSubmit={onSubmit} className="space-y-4 p-5">
              <Input
                label="Device name"
                name="title"
                defaultValue={initial.title}
                required
                autoFocus
              />
              <Textarea
                label="Description"
                name="description"
                rows={3}
                defaultValue={initial.description}
                placeholder="What does this device do?"
              />
              {error && (
                <p className="rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={loading}>
                  Save changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
