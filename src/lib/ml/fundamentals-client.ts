// Thin client for the fundamentals sidecar.
// Fails open: any network/transport error returns empty rows + everything
// in skipped, so the scanner pipeline keeps running without fundamentals.
//
// Fallback chain when the sidecar is unreachable:
//   1. FMP direct REST API  (if FMP_API_KEY is set)
//   2. Yahoo Finance quoteSummary (zero-config, same source as the Python sidecar)

export interface FundamentalRow {
  symbol: string;
  revenue_growth: number | null;
  earnings_growth: number | null;
  profit_margin: number | null;
  roe: number | null;
  debt_to_equity: number | null;
  forward_pe: number | null;
}

export interface FundamentalsResponse {
  rows: FundamentalRow[];
  skipped: string[];
}

const BASE = process.env.FUNDAMENTALS_SIDECAR_URL ?? "http://fundamentals:8000";
const TIMEOUT_MS = Number(process.env.FUNDAMENTALS_TIMEOUT_MS ?? "5000");

let lastHealth: { ok: boolean; ts: number } = { ok: false, ts: 0 };
const HEALTH_TTL_MS = 30_000;

async function pingHealth(): Promise<boolean> {
  if (Date.now() - lastHealth.ts < HEALTH_TTL_MS) return lastHealth.ok;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1000);
    const res = await fetch(`${BASE}/health`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    lastHealth = { ok: res.ok, ts: Date.now() };
    return res.ok;
  } catch {
    lastHealth = { ok: false, ts: Date.now() };
    return false;
  }
}

function hasAnyData(row: FundamentalRow): boolean {
  return (
    row.revenue_growth != null ||
    row.earnings_growth != null ||
    row.profit_margin != null ||
    row.roe != null ||
    row.debt_to_equity != null ||
    row.forward_pe != null
  );
}

export async function fetchFundamentals(symbols: string[]): Promise<FundamentalsResponse> {
  if (symbols.length === 0) return { rows: [], skipped: [] };

  // Primary: Python sidecar.
  if (await pingHealth()) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}/fundamentals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbols }),
        signal: ctrl.signal,
        cache: "no-store",
      });
      clearTimeout(t);
      if (res.ok) {
        const data = (await res.json()) as FundamentalsResponse;
        if (data.rows.some(hasAnyData)) return data;
        console.warn("[fundamentals] sidecar returned all-null rows, falling through");
      } else {
        console.warn("[fundamentals] sidecar fetch failed:", res.status, res.statusText);
      }
    } catch (err) {
      console.warn("[fundamentals] sidecar transport error:", err);
    }
  }

  // Secondary: FMP direct REST (if key is configured).
  const fmpKey = process.env.FMP_API_KEY;
  if (fmpKey) {
    const { fetchFundamentalsViaFmp } = await import("./fmp-fundamentals");
    const fmpResult = await fetchFundamentalsViaFmp(fmpKey, symbols);
    if (fmpResult.rows.some(hasAnyData)) return fmpResult;
    console.warn("[fundamentals] FMP returned all-null rows, falling through to Yahoo Finance");
  }

  // Tertiary: Yahoo Finance quoteSummary — same source as the Python sidecar,
  // zero config required.
  const { fetchFundamentalsViaYf } = await import("./yf-fundamentals");
  return fetchFundamentalsViaYf(symbols);
}
