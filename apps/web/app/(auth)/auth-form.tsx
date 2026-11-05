"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Input } from "@/components/ui";
import { apiUrl } from "@/lib/base-path";

type Mode = "login" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const payload = {
      name: form.get("name") as string | null,
      email: form.get("email") as string,
      pass: form.get("pass") as string,
    };

    try {
      const res = await fetch(apiUrl(`/api/auth/${mode}`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        setLoading(false);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Network error — please try again");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {isSignup && (
        <Input
          label="Name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="Ada Lovelace"
          required
        />
      )}
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        required
      />
      <Input
        label="Password"
        name="pass"
        type="password"
        autoComplete={isSignup ? "new-password" : "current-password"}
        placeholder="••••••••"
        minLength={8}
        required
      />

      {error && (
        <p className="rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      <Button type="submit" loading={loading} className="w-full">
        {isSignup ? "Create account" : "Log in"}
      </Button>

      <p className="pt-2 text-center text-sm text-[var(--muted)]">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-[var(--base-blue)] hover:underline underline-offset-4"
            >
              Log in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link
              href="/signup"
              className="font-medium text-[var(--base-blue)] hover:underline underline-offset-4"
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
