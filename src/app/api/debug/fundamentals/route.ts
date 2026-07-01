// Dev-only endpoint: hit /api/debug/fundamentals to see which source fires
// and what raw data comes back for a small test set.
import { NextResponse } from "next/server";
import { fetchFundamentals } from "@/lib/ml/fundamentals-client";

export const dynamic = "force-dynamic";

const TEST_SYMBOLS = ["AAPL", "MSFT", "NVDA"];

export async function GET() {
  const start = Date.now();
  const result = await fetchFundamentals(TEST_SYMBOLS);
  return NextResponse.json({
    elapsed_ms: Date.now() - start,
    fmp_key_set: !!process.env.FMP_API_KEY,
    sidecar_url: process.env.FUNDAMENTALS_SIDECAR_URL ?? "http://fundamentals:8000",
    rows: result.rows,
    skipped: result.skipped,
  });
}
