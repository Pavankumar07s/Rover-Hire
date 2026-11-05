import { AuthForm } from "../auth-form";

export const metadata = { title: "Sign up · 0xBs" };

export default function SignupPage() {
  return (
    <div className="space-y-6">
      <div>
        <span className="tech-label text-[var(--base-blue)]">// register</span>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          Create your account
        </h1>
        <p className="prompt mt-1 text-sm text-[var(--muted)]">
          Start registering devices in seconds.
        </p>
      </div>
      <AuthForm mode="signup" />
    </div>
  );
}
