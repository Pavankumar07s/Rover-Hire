import { AuthForm } from "../auth-form";

export const metadata = { title: "Log in · 0xBs" };

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div>
        <span className="tech-label text-[var(--base-blue)]">// auth</span>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          Welcome back
        </h1>
        <p className="prompt mt-1 text-sm text-[var(--muted)]">
          Log in to manage your devices and services.
        </p>
      </div>
      <AuthForm mode="login" />
    </div>
  );
}
