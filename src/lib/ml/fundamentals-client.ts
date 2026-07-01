// Thin client for the fundamentals sidecar.
// Fails open: any network/transport error returns empty rows + everything
// in skipped, so the scanner pipeline keeps running without fundamentals.
// Fallback tier: if the sidecar is offline and FMP_API_KEY is set, the
// request is forwarded to the direct FMP REST client (fmp-fundamentals.ts).

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
// yfinance can be slow on cold-start; 5s gives the first request room.
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

export async function fetchFundamentals(symbols: string[]): Promise<FundamentalsResponse> {
  if (symbols.length === 0) return { rows: [], skipped: [] };
  if (!(await pingHealth())) {
    if (process.env.FMP_API_KEY) {
      const { fetchFundamentalsViaFmp } = await import("./fmp-fundamentals");
      return fetchFundamentalsViaFmp(symbols);
    }
    // No API key configured — fall back to Yahoo Finance (same source as the
    // Python sidecar's yfinance calls, no auth required).
    const { fetchFundamentalsViaYf } = await import("./yf-fundamentals");
    return fetchFundamentalsViaYf(symbols);
  }

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
    if (!res.ok) {
      console.warn("[fundamentals] fetch failed:", res.status, res.statusText);
      return { rows: [], skipped: [...symbols] };
    }
    return (await res.json()) as FundamentalsResponse;
  } catch (err) {
    console.warn("[fundamentals] transport error:", err);
    return { rows: [], skipped: [...symbols] };
  }
}
