import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMonitor, runHistoricalBacklog } from "@/lib/shadow";

const HORIZONS = new Set(["3d", "5d", "10d"]);

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as
    | { horizon?: string; force?: boolean }
    | null;
  if (!body || !body.horizon || !HORIZONS.has(body.horizon)) {
    return NextResponse.json({ error: "bad horizon" }, { status: 400 });
  }
  const m = getMonitor(body.horizon as "3d"|"5d"|"10d");
  if (!m) return NextResponse.json({ error: "monitor disabled" }, { status: 503 });
  // Fire-and-forget; caller polls /summary for progress.
  void runHistoricalBacklog(m, { force: !!body.force });
  return NextResponse.json({ scheduled: true });
}
