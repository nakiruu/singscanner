import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    horizon: process.env.SCANNER_HORIZON ?? "3d",
    universe: process.env.SCANNER_UNIVERSE ?? "auto",
    maxSymbols: Number(process.env.SCANNER_MAX_SYMBOLS ?? 300),
    mock: process.env.SCANNER_MOCK !== "false",
    uptime: process.uptime(),
    ts: new Date().toISOString(),
  });
}
