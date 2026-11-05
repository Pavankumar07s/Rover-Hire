"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { apiUrl } from "@/lib/base-path";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await fetch(apiUrl("/api/auth/logout"), { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button variant="ghost" loading={loading} onClick={logout}>
      Log out
    </Button>
  );
}
