import { NextResponse } from "next/server";
import { getLatestSnapshot } from "@/lib/engine/scanner";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // ?h=3d|5d|10d|21d — falls back to the server default if omitted / invalid.
  const url = new URL(req.url);
  const horizon = url.searchParams.get("h") ?? undefined;
  const snapshot = await getLatestSnapshot(horizon);
  return NextResponse.json(snapshot, {
    headers: { "cache-control": "no-store" },
  });
}
