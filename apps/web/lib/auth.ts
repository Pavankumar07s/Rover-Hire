import "server-only";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

export const SESSION_COOKIE = "authorization";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

type SessionPayload = jwt.JwtPayload & {
  userid?: string;
};

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }
  return secret;
}

/** Mint a session JWT. Auth-controller never issues this — so existing
 *  cookies keep working if that service is down. */
export function signSession(userId: string): string {
  return jwt.sign({ userid: userId }, getJwtSecret(), { expiresIn: "7d" });
}

/** Persist the session token in an httpOnly cookie. */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Remove the session cookie (logout). */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Read + verify the session cookie.
 * Returns the authenticated user id, or null if not authenticated.
 */
export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;

  try {
    const payload = jwt.verify(token, getJwtSecret()) as SessionPayload;
    return payload.userid ?? null;
  } catch {
    return null;
  }
}
