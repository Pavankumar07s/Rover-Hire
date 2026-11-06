import { hub } from "@/lib/hub";

export const dynamic = "force-dynamic";

/** Server-sent events: the merged snapshot, a few times a second. */
export async function GET(req: Request) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const off = hub().subscribe((s) => controller.enqueue(enc.encode(`data: ${JSON.stringify(s)}\n\n`)));
      req.signal.addEventListener("abort", () => {
        off();
        controller.close();
      });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
