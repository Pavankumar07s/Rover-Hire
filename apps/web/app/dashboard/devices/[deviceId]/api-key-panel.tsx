"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { ApiKeyReveal } from "@/components/api-key-reveal";
import { apiUrl } from "@/lib/base-path";

export function ApiKeyPanel({
  deviceId,
  apiKeyPreview,
}: {
  deviceId: string;
  apiKeyPreview: string;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState(apiKeyPreview);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function rotate() {
    const confirmed = window.confirm(
      "Rotate the API key? The current key stops working immediately, and the new key is shown only once.",
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/devices/${deviceId}/rotate`), {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.apiKey) {
        setRotatedKey(data.apiKey);
        setPreview(data.apiKeyPreview ?? preview);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  if (rotatedKey) {
    return (
      <ApiKeyReveal apiKey={rotatedKey} onDone={() => setRotatedKey(null)} />
    );
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Device API key
          </h3>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            The key is shown only once, at creation. Rotate to mint a new one.
          </p>
        </div>
        <Button variant="outline" loading={loading} onClick={rotate}>
          Rotate key
        </Button>
      </div>

      <div className="mt-4">
        <code className="block w-full overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 font-mono text-sm text-[var(--muted)]">
          {preview}
        </code>
      </div>
    </Card>
  );
}
