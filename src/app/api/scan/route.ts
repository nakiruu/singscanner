import { NextResponse } from "next/server";
import { getLatestSnapshot } from "@/lib/engine/scanner";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getLatestSnapshot();
  return NextResponse.json(snapshot, {
    headers: { "cache-control": "no-store" },
  });
}
