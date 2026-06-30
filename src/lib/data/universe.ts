// Active-equity universe builder.
// Docs: https://docs.alpaca.markets/reference/get-v2-assets
// NOTE: trading API base (api.alpaca.markets), NOT the data API.
//
// Mirrors data.py:228-246 (active_us_equities) for asset filtering, then ranks
// the survivors by 20d avg dollar volume using fetchDailyBars + computeBarFeatures
// (see src/lib/data/bars.ts).

import { fetchDailyBars, computeBarFeatures } from "./bars";

const TRADING_BASE = "https://api.alpaca.markets";

export interface UniverseEntry {
  symbol: string;
  exchange: "NYSE" | "NASDAQ" | "OTHER";
}

interface RawAsset {
  symbol: string;
  exchange: string;
  tradable: boolean;
  status: string;
  asset_class: string;
}

export class AlpacaUniverseError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "AlpacaUniverseError";
  }
}

function authHeaders(): Record<string, string> {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;
  if (!key || !secret) {
    throw new AlpacaUniverseError("ALPACA_API_KEY / ALPACA_API_SECRET not set");
  }
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    Accept: "application/json",
  };
}

// Mirror of DEFAULT_UNIVERSE in src/lib/engine/scanner.ts. Kept in sync by hand
// because the singleton's export surface is intentionally untouched.
const DEFAULT_UNIVERSE_FALLBACK: readonly string[] = [
  "NVDA","AMD","TSLA","AAPL","MSFT","META","AMZN","GOOGL","AVGO","CRWD",
  "PLTR","COIN","SHOP","UBER","NFLX","SNOW","ARM","SMCI","MU","ASML",
];

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

interface AssetCache {
  list: UniverseEntry[] | null;
  ts: number;
}
interface RankedCache {
  // Keyed by maxSymbols so different caller budgets don't collide.
  byMax: Map<number, { entries: UniverseEntry[]; ts: number }>;
}

const assetCache: AssetCache = { list: null, ts: 0 };
const rankedCache: RankedCache = { byMax: new Map() };

const ASSET_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RANKED_TTL_MS = 6 * 60 * 60 * 1000; // 6h

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function fetchAssets(): Promise<UniverseEntry[]> {
  if (assetCache.list && Date.now() - assetCache.ts < ASSET_TTL_MS) {
    return assetCache.list;
  }
  try {
    const url =
      `${TRADING_BASE}/v2/assets?status=active&asset_class=us_equity`;
    const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) {
      throw new AlpacaUniverseError(
        `alpaca assets failed: ${res.status} ${res.statusText}`,
        res.status,
      );
    }
    const raw = (await res.json()) as RawAsset[];
    const out: UniverseEntry[] = [];
    for (const a of raw) {
      if (!a.tradable) continue;
      // data.py:243-245 — skip dotted/slashed symbols (preferreds, when-issued, …)
      if (!a.symbol || a.symbol.includes(".") || a.symbol.includes("/")) continue;
      let exch: UniverseEntry["exchange"];
      if (a.exchange === "NYSE") exch = "NYSE";
      else if (a.exchange === "NASDAQ") exch = "NASDAQ";
      else continue; // Spec: only NYSE / NASDAQ.
      out.push({ symbol: a.symbol, exchange: exch });
    }
    assetCache.list = out;
    assetCache.ts = Date.now();
    return out;
  } catch {
    // Fail-open with whatever we cached previously, else the hardcoded fallback.
    if (assetCache.list) return assetCache.list;
    return DEFAULT_UNIVERSE_FALLBACK.map((s) => ({
      symbol: s,
      exchange: "NASDAQ" as const,
    }));
  }
}

// Rank `entries` by 20d avg dollar volume using the bars adapter. Chunks the
// symbol set into batches of 100 (the bars endpoint's batch ceiling).
async function rankByDollarVolume(
  entries: UniverseEntry[],
  topN: number,
): Promise<UniverseEntry[]> {
  if (entries.length === 0) return [];
  const symbols = entries.map((e) => e.symbol);
  let bars: Map<string, import("./bars").DailyBar[]>;
  try {
    bars = await fetchDailyBars(symbols, 30);
  } catch {
    return entries.slice(0, topN);
  }
  const scored: { entry: UniverseEntry; vol: number }[] = [];
  for (const e of entries) {
    const b = bars.get(e.symbol);
    if (!b || b.length < 20) continue;
    const feats = computeBarFeatures(b, null, null);
    if (feats.avg_dollar_vol_20d === null) continue;
    scored.push({ entry: e, vol: feats.avg_dollar_vol_20d });
  }
  scored.sort((a, b) => b.vol - a.vol);
  return scored.slice(0, topN).map((s) => s.entry);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchActiveUniverse(
  maxSymbols: number,
): Promise<UniverseEntry[]> {
  // Short-circuit: default 20-symbol universe.
  // (See DEFAULT_UNIVERSE in src/lib/engine/scanner.ts — mirrored here.)
  if (maxSymbols <= 300 && process.env.SCANNER_UNIVERSE === "default") {
    return DEFAULT_UNIVERSE_FALLBACK.map((s) => ({
      symbol: s,
      exchange: "NASDAQ" as const,
    }));
  }

  const cached = rankedCache.byMax.get(maxSymbols);
  if (cached && Date.now() - cached.ts < RANKED_TTL_MS) {
    return cached.entries;
  }

  const assets = await fetchAssets();
  if (assets.length === 0) return [];

  const ranked = await rankByDollarVolume(assets, maxSymbols);
  const out = ranked.length > 0 ? ranked : assets.slice(0, maxSymbols);
  rankedCache.byMax.set(maxSymbols, { entries: out, ts: Date.now() });
  return out;
}
