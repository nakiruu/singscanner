// Yahoo Finance quoteSummary client — zero-config fundamentals fallback.
// Mirrors what the Python yfinance sidecar does internally, so this is the
// same data source with no API key required.
//
// Rate limiting: YF caps at ~2000 req/hr per IP. With concurrency=3 and 6h
// symbol-level caching, a 100-symbol universe makes at most 100 req per 6h.

import type { FundamentalRow, FundamentalsResponse } from "./fundamentals-client";

const YF_BASE = "https://query2.finance.yahoo.com";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CONCURRENCY = 3;
const TIMEOUT_MS = 8_000;

// YF requires a browser-like UA or it returns 404 / throttles aggressively.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface CacheEntry { row: FundamentalRow; ts: number }
const cache = new Map<string, CacheEntry>();

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (v != null && typeof (v as Record<string, unknown>).raw === "number") {
    const raw = (v as { raw: number }).raw;
    return isFinite(raw) ? raw : null;
  }
  return null;
}

async function fetchOneSymbol(symbol: string): Promise<FundamentalRow> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const modules = "financialData,defaultKeyStatistics";
    const url = `${YF_BASE}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&formatted=true&lang=en-US&region=US`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return nullRow(symbol);
    const json = (await res.json()) as Record<string, unknown>;
    const result = (json?.quoteSummary as Record<string, unknown> | undefined)
      ?.result as Record<string, unknown>[] | undefined;
    const r = result?.[0];
    if (!r) return nullRow(symbol);
    const fd = (r.financialData ?? {}) as Record<string, unknown>;
    const ks = (r.defaultKeyStatistics ?? {}) as Record<string, unknown>;
    return {
      symbol,
      revenue_growth:  numOrNull(fd.revenueGrowth),
      earnings_growth: numOrNull(fd.earningsGrowth),
      profit_margin:   numOrNull(fd.profitMargins),
      roe:             numOrNull(fd.returnOnEquity) ?? numOrNull(ks.returnOnEquity),
      debt_to_equity:  numOrNull(fd.debtToEquity),
      forward_pe:      numOrNull(fd.forwardPE) ?? numOrNull(ks.forwardPE),
    };
  } catch {
    return nullRow(symbol);
  } finally {
    clearTimeout(t);
  }
}

function nullRow(symbol: string): FundamentalRow {
  return { symbol, revenue_growth: null, earnings_growth: null, profit_margin: null, roe: null, debt_to_equity: null, forward_pe: null };
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

export async function fetchFundamentalsViaYf(symbols: string[]): Promise<FundamentalsResponse> {
  if (symbols.length === 0) return { rows: [], skipped: [] };
  const now = Date.now();
  const rows: FundamentalRow[] = [];
  const skipped: string[] = [];
  const toFetch: string[] = [];

  for (const sym of symbols) {
    const hit = cache.get(sym);
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
          const row = await fetchOneSymbol(sym);
          cache.set(sym, { row, ts: now });
          return row;
        } catch {
          skipped.push(sym);
          return nullRow(sym);
        }
      }),
    );
    rows.push(...fetched);
  }

  return { rows, skipped };
}
