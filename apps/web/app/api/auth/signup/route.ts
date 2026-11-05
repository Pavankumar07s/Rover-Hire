import { NextResponse } from "next/server";
import { signSession, setSessionCookie } from "@/lib/auth";
import { callAuthController } from "@/lib/auth-controller";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const pass = typeof body?.pass === "string" ? body.pass : "";

  if (!name || !email || !pass) {
    return NextResponse.json(
      { error: "name, email and pass are required" },
      { status: 400 },
    );
  }

  const result = await callAuthController("/auth/signup", { name, email, pass });
  if (!result.ok) return result.response;

  await setSessionCookie(signSession(result.user.id));
  return NextResponse.json({ user: result.user }, { status: 201 });
}
