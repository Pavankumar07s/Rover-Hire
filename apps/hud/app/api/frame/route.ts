import { config, roverHeaders } from "@/lib/config";

export const dynamic = "force-dynamic";

/** The rover's latest camera frame, fetched with the token on this side. */
export async function GET() {
  const r = await fetch(`${config.roverUrl}/frame`, { headers: roverHeaders(), signal: AbortSignal.timeout(3000), cache: "no-store" })
    .catch(() => null);
  if (!r?.ok) return new Response("no frame", { status: 503 });
  return new Response(await r.arrayBuffer(), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
}
