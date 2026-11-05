"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Textarea } from "@/components/ui";
import { ApiKeyReveal } from "@/components/api-key-reveal";
import { apiUrl } from "@/lib/base-path";

export function CreateDevice() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mintedKey, setMintedKey] = useState<string | null>(null);
  const [connectorId, setConnectorId] = useState<string | null>(null);

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
      const res = await fetch(apiUrl("/api/devices"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not create device");
        setLoading(false);
        return;
      }
      // Show the raw key exactly once before refreshing the list.
      setMintedKey(data.apiKey ?? null);
      setConnectorId(data.device?.connectorId ?? null);
      setLoading(false);
      router.refresh();
    } catch {
      setError("Network error — please try again");
      setLoading(false);
    }
  }

  // After creation: show the one-time key.
  if (mintedKey) {
    return (
      <div className="w-full">
        <ApiKeyReveal
          apiKey={mintedKey}
          connectorId={connectorId}
          onDone={() => {
            setMintedKey(null);
            setConnectorId(null);
            setOpen(false);
            router.refresh();
          }}
        />
      </div>
    );
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <span className="text-base leading-none">+</span> New device
      </Button>
    );
  }

  return (
    <Card className="w-full p-5">
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Register a device
          </h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[13px] font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
        </div>

        <Input
          label="Device name"
          name="title"
          placeholder="e.g. Edge Gateway 01"
          required
          autoFocus
        />
        <Textarea
          label="Description"
          name="description"
          rows={2}
          placeholder="What does this device do?"
        />

        <p className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)]/40 px-4 py-3 text-[12px] leading-snug text-[var(--muted)]">
          Add services after the device is created. Each service has its own
          payout wallet, can be free or paid, and sets its own password
          protection and discoverability.
        </p>

        {error && (
          <p className="rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        <Button type="submit" loading={loading}>
          Create device & mint key
        </Button>
      </form>
    </Card>
  );
}
