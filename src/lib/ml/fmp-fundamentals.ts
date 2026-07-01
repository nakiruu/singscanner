// Direct FMP REST API client for fundamentals.
// Used as a fallback when the Python sidecar (fundamentals-client.ts) is
// unavailable. Caches per-symbol for 6 h — fundamentals are quarterly, so
// staleness within a session is not a concern.
//
// Requires FMP_API_KEY in env. Without it, returns empty immediately.
//
// Endpoints used:
//   /v3/ratios-ttm/{symbol}       → netProfitMarginTTM, returnOnEquityTTM,
//                                   debtEquityRatioTTM, priceEarningsRatioTTM
//   /v3/financial-growth/{symbol} → revenueGrowth, netIncomeGrowth

import type { FundamentalRow, FundamentalsResponse } from "./fundamentals-client";

const FMP_BASE = "https://financialmodelingprep.com/api";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CONCURRENCY = 5;
const TIMEOUT_MS = 5_000;

interface CacheEntry { row: FundamentalRow; ts: number }
const fundamentalsCache = new Map<string, CacheEntry>();

function fmpFetch(apiKey: string, path: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(`${FMP_BASE}${path}&apikey=${apiKey}`, {
    signal: ctrl.signal,
    cache: "no-store",
  }).finally(() => clearTimeout(t));
}

function numField(d: Record<string, unknown>, key: string): number | null {
  const v = d[key];
  if (typeof v === "number" && isFinite(v)) return v;
  return null;
}

async function fetchRatios(apiKey: string, symbol: string): Promise<{
  profit_margin: number | null;
  roe: number | null;
  debt_to_equity: number | null;
  forward_pe: number | null;
}> {
  const empty = { profit_margin: null, roe: null, debt_to_equity: null, forward_pe: null };
  try {
    const res = await fmpFetch(apiKey, `/v3/ratios-ttm/${symbol}?`);
    if (!res.ok) {
      console.warn(`[fmp] ratios-ttm ${symbol} → ${res.status} ${res.statusText}`);
      return empty;
    }
    const data = (await res.json()) as Record<string, unknown>[];
    const d = Array.isArray(data) ? (data[0] ?? {}) : {};
    const result = {
      profit_margin:  numField(d, "netProfitMarginTTM"),
      roe:            numField(d, "returnOnEquityTTM"),
      debt_to_equity: numField(d, "debtEquityRatioTTM"),
      forward_pe:     numField(d, "priceEarningsRatioTTM"),
    };
    if (Object.values(result).every((v) => v == null)) {
      console.warn(`[fmp] ratios-ttm ${symbol} → all fields null. keys: ${Object.keys(d).join(",").slice(0, 120)}`);
    }
    return result;
  } catch (err) {
    console.warn(`[fmp] ratios-ttm ${symbol} → error:`, err);
    return empty;
  }
}

async function fetchGrowth(apiKey: string, symbol: string): Promise<{
  revenue_growth: number | null;
  earnings_growth: number | null;
}> {
  const empty = { revenue_growth: null, earnings_growth: null };
  try {
    const res = await fmpFetch(apiKey, `/v3/financial-growth/${symbol}?limit=1&`);
    if (!res.ok) {
      console.warn(`[fmp] financial-growth ${symbol} → ${res.status} ${res.statusText}`);
      return empty;
    }
    const data = (await res.json()) as Record<string, unknown>[];
    const d = Array.isArray(data) ? (data[0] ?? {}) : {};
    return {
      revenue_growth:  numField(d, "revenueGrowth"),
      earnings_growth: numField(d, "netIncomeGrowth"),
    };
  } catch (err) {
    console.warn(`[fmp] financial-growth ${symbol} → error:`, err);
    return empty;
  }
}

async function fetchOneSymbol(apiKey: string, symbol: string): Promise<FundamentalRow> {
  const [ratios, growth] = await Promise.all([
    fetchRatios(apiKey, symbol),
    fetchGrowth(apiKey, symbol),
  ]);
  return { symbol, ...ratios, ...growth };
}

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

export async function fetchFundamentalsViaFmp(
  apiKey: string,
  symbols: string[],
): Promise<FundamentalsResponse> {
  if (!apiKey || symbols.length === 0) return { rows: [], skipped: [...symbols] };

  const now = Date.now();
  const rows: FundamentalRow[] = [];
  const skipped: string[] = [];
  const toFetch: string[] = [];

  for (const sym of symbols) {
    const hit = fundamentalsCache.get(sym);
    if (hit && now - hit.ts < CACHE_TTL_MS) {
      rows.push(hit.row);
    } else {
      toFetch.push(sym);
    }
  }

  if (toFetch.length > 0) {
    const fetched = await pooled(
      toFetch.map((sym) => async () => {
        try {
          const row = await fetchOneSymbol(apiKey, sym);
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

  const populated = rows.filter(hasAnyData);
  if (populated.length === 0 && rows.length > 0) {
    console.warn(`[fmp] all ${rows.length} rows returned all-null fields — FMP key may lack access to ratios-ttm`);
  }

  return { rows, skipped };
}
