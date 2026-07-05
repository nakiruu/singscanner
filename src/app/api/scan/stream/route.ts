import { getLatestSnapshot } from "@/lib/engine/scanner";

export const dynamic = "force-dynamic";

const TICK_MS = 5_000;

export async function GET(req: Request) {
  // ?h=3d|5d|10d|21d — each SSE connection subscribes to one horizon.
  // Switching horizon on the client closes and re-opens the stream.
  const url = new URL(req.url);
  const horizon = url.searchParams.get("h") ?? undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("hello", { ts: Date.now(), horizon: horizon ?? null });
      send("snapshot", await getLatestSnapshot(horizon));

      const interval = setInterval(async () => {
        try {
          send("snapshot", await getLatestSnapshot(horizon));
        } catch {
          clearInterval(interval);
          controller.close();
        }
      }, TICK_MS);

      const abort = () => {
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener("abort", abort);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
