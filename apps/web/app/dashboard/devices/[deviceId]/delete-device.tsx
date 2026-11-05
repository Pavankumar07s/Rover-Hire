"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { apiUrl } from "@/lib/base-path";

export function DeleteDevice({ deviceId }: { deviceId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function remove() {
    if (
      !window.confirm(
        "Delete this device? All of its services will be removed too.",
      )
    )
      return;
    setLoading(true);
    const res = await fetch(apiUrl(`/api/devices/${deviceId}`), { method: "DELETE" });
    if (res.ok) {
      router.replace("/dashboard");
      router.refresh();
    } else {
      setLoading(false);
    }
  }

  return (
    <Button variant="danger" loading={loading} onClick={remove}>
      Delete device
    </Button>
  );
}
