import { downloadHttp } from "@0xBs/zg/browser";
import { config, roverHeaders } from "@/lib/config";

/** A delivered photo: from 0G Storage by its root once uploaded, else from the rover while its mission runs. */
export async function GET(req: Request, ctx: RouteContext<"/api/photo/[n]">) {
  const { n } = await ctx.params;
  const root = new URL(req.url).searchParams.get("root");
  if (!/^\d+$/.test(n) || (root && !/^0x[0-9a-f]{64}$/.test(root))) return new Response("bad request", { status: 400 });
  const jpeg = root
    ? await downloadHttp(root).catch(() => null)
    : await fetch(`${config.roverUrl}/photo/${n}`, { headers: roverHeaders(), signal: AbortSignal.timeout(3000) })
        .then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  if (!jpeg) return new Response("no such photo", { status: 404, headers: { "Cache-Control": "no-store" } });
  // The rover's copy stands in only until the 0G copy exists; the rover answers by photo number, so never cache it.
  return new Response(jpeg as BodyInit, { headers: { "Content-Type": "image/jpeg", "Cache-Control": root ? "private, max-age=86400" : "no-store" } });
}
