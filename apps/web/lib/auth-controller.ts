import { NextResponse } from "next/server";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
};

function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== "object") return false;
  const u = value as Record<string, unknown>;
  return (
    typeof u.id === "string" &&
    typeof u.name === "string" &&
    typeof u.email === "string"
  );
}

/**
 * Identity calls (login/signup) go to auth-controller.
 * Session JWTs stay on this app — if auth-controller is down, existing
 * cookies still authenticate dashboard and device APIs.
 */
export async function callAuthController(
  path: "/auth/login" | "/auth/signup",
  body: unknown,
): Promise<{ ok: true; user: AuthUser } | { ok: false; response: NextResponse }> {
  const base = process.env.AUTH_CONTROLLER_URL?.replace(/\/$/, "");
  if (!base) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Auth service unavailable" },
        { status: 503 },
      ),
    };
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Auth service unavailable" },
        { status: 503 },
      ),
    };
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    user?: unknown;
  };

  if (!res.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: typeof data.error === "string" ? data.error : "Something went wrong" },
        { status: res.status },
      ),
    };
  }

  if (!isAuthUser(data.user)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Auth service unavailable" },
        { status: 502 },
      ),
    };
  }

  return { ok: true, user: data.user };
}
