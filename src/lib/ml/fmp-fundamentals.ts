// Direct FMP REST API client for fundamentals.
// Used as a fallback when the Python sidecar (fundamentals-client.ts) is
// unavailable. Caches per-symbol for 6 h — fundamentals are quarterly, so
// staleness within a session is not a concern.
//
// Requires FMP_API_KEY in env. Without it, returns empty immediately.

import type { FundamentalRow, FundamentalsResponse } from "./fundamentals-client";

const FMP_KEY = process.env.FMP_API_KEY ?? "";
const FMP_BASE = "https://financialmodelingprep.com/api";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CONCURRENCY = 5;
const TIMEOUT_MS = 5_000;

interface CacheEntry { row: FundamentalRow; ts: number }
const fundamentalsCache = new Map<string, CacheEntry>();

function fmpFetch(path: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(`${FMP_BASE}${path}&apikey=${FMP_KEY}`, {
    signal: ctrl.signal,
    cache: "no-store",
  }).finally(() => clearTimeout(t));
}

async function fetchKeyMetrics(symbol: string): Promise<{
  profit_margin: number | null;
  roe: number | null;
  debt_to_equity: number | null;
  forward_pe: number | null;
}> {
  try {
    const res = await fmpFetch(`/v3/key-metrics-ttm/${symbol}?`);
    if (!res.ok) return { profit_margin: null, roe: null, debt_to_equity: null, forward_pe: null };
    const data = (await res.json()) as Record<string, unknown>[];
    const d = data[0] ?? {};
    return {
      profit_margin:  (d.netProfitMarginTTM  as number | null) ?? null,
      roe:            (d.roeTTM              as number | null) ?? null,
      debt_to_equity: (d.debtToEquityTTM     as number | null) ?? null,
      forward_pe:     (d.peRatioTTM          as number | null) ?? null,
    };
  } catch {
    return { profit_margin: null, roe: null, debt_to_equity: null, forward_pe: null };
  }
}

async function fetchGrowth(symbol: string): Promise<{
  revenue_growth: number | null;
  earnings_growth: number | null;
}> {
  try {
    const res = await fmpFetch(`/v3/financial-growth/${symbol}?limit=1&`);
    if (!res.ok) return { revenue_growth: null, earnings_growth: null };
    const data = (await res.json()) as Record<string, unknown>[];
    const d = data[0] ?? {};
    return {
      revenue_growth:  (d.revenueGrowth   as number | null) ?? null,
      earnings_growth: (d.netIncomeGrowth  as number | null) ?? null,
    };
  } catch {
    return { revenue_growth: null, earnings_growth: null };
  }
}

async function fetchOneSymbol(symbol: string): Promise<FundamentalRow> {
  const [km, gr] = await Promise.all([fetchKeyMetrics(symbol), fetchGrowth(symbol)]);
  return { symbol, ...km, ...gr };
}

// Simple concurrency pool: at most CONCURRENCY tasks in flight.
async function pooled<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const i = cursor++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

export async function fetchFundamentalsViaFmp(symbols: string[]): Promise<FundamentalsResponse> {
  if (!FMP_KEY || symbols.length === 0) return { rows: [], skipped: [...symbols] };

  const now = Date.now();
  const rows: FundamentalRow[] = [];
  const skipped: string[] = [];
  const toFetch: Array<{ sym: string; idx: number }> = [];

  for (const sym of symbols) {
    const hit = fundamentalsCache.get(sym);
    if (hit && now - hit.ts < CACHE_TTL_MS) {
      rows.push(hit.row);
    } else {
      toFetch.push({ sym, idx: toFetch.length });
    }
  }

  if (toFetch.length > 0) {
    const fetched = await pooled(
      toFetch.map(({ sym }) => async () => {
        try {
          const row = await fetchOneSymbol(sym);
          fundamentalsCache.set(sym, { row, ts: now });
          return row;
        } catch {
          skipped.push(sym);
          return null;
        }
      }),
    );
    for (const row of fetched) {
      if (row != null) rows.push(row);
    }
  }

  return { rows, skipped };
}
