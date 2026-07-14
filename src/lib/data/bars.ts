// Alpaca Market Data v2 historical bars client + derived feature math.
// Docs: https://docs.alpaca.markets/reference/stockbars
//
// Endpoint:
//   GET https://data.alpaca.markets/v2/stocks/bars
//     ?symbols=A,B,C&timeframe=1Day&start=…&end=…&limit=…&feed=iex
// Response: { bars: { AAPL: [{t,o,h,l,c,v,vw?}, …], … }, next_page_token: string|null }
//
// Both fetchers batch up to 100 symbols per request and follow next_page_token.
// They are FAIL-OPEN: on error they return an empty Map and the caller decides.
//
// Derived features (computeBarFeatures) port the math in:
//   C:\Users\nicopc\Downloads\singscannerml1\data.py
//     compute_daily_features (lines 111-186)
// and the bar-volatility computation in:
//   C:\Users\nicopc\Downloads\singscannerml1\engine.py (lines 629-633)
// Citations in comments use the `data.py:NN` / `engine.py:NN` form.

import { insertBars, queryBarsMulti, isClickhouseEnabled } from "./clickhouse";
import { recordAlpacaFetch, recordError } from "./metrics";

const DATA_BASE = "https://data.alpaca.markets/v2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
}

export interface IntradayBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
}

export type IntradayTimeframe = "5Min" | "1Min";

export interface BarFeatures {
  // short-term lookbacks (ml2/data.py:124-138) — critical for 5-10d horizons
  ret_3d: number | null;
  ret_5d: number | null;
  ret_10d: number | null;
  ret_prev_5d: number | null;          // 5d window before the last (short_accel input)

  ret_21d: number | null;
  ret_63d: number | null;
  ret_126d: number | null;
  ret_prev_21d: number | null;
  trend_slope: number | null;
  sma50: number | null;
  sma200: number | null;
  high_60d: number | null;
  realized_vol_ann: number | null;
  max_drawdown_60d: number | null;
  beta_vs_spy: number | null;
  vol_pct_per_bar: number | null;
  avg_dollar_vol_20d: number | null;
}

interface RawBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
}

interface BarsResponse {
  bars: Record<string, RawBar[]> | null;
  next_page_token: string | null;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export class AlpacaBarsError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "AlpacaBarsError";
  }
}

function authHeaders(): Record<string, string> {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;
  if (!key || !secret) {
    throw new AlpacaBarsError("ALPACA_API_KEY / ALPACA_API_SECRET not set");
  }
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    Accept: "application/json",
  };
}

function feed(): string {
  return process.env.ALPACA_FEED ?? "iex";
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Threshold for "enough" bars from L2 before we skip Alpaca for a symbol.
// Matches the *0.6 slack the Alpaca fetch already tolerates (data.py:273).
function enoughDailyFromL2(bars: DailyBar[], lookbackDays: number): boolean {
  return bars.length >= Math.floor(lookbackDays * 0.6);
}
function enoughIntradayFromL2(bars: IntradayBar[], lookbackMin: number, timeframe: IntradayTimeframe): boolean {
  const barMin = timeframe === "1Min" ? 1 : 5;
  const expected = Math.floor(lookbackMin / barMin);
  // Intraday is stricter: require at least 80% of expected bars before trusting L2.
  return bars.length >= Math.floor(expected * 0.8);
}

// ---------------------------------------------------------------------------
// Caches (module-scope, TTL'd by stamp)
// ---------------------------------------------------------------------------

interface DailyCacheEntry {
  bars: Map<string, DailyBar[]>;
  ts: number;
  tradingDay: string; // YYYY-MM-DD of end
}
interface IntradayCacheEntry {
  bars: Map<string, IntradayBar[]>;
  ts: number;
}

const dailyCache = new Map<string, DailyCacheEntry>();
const intradayCache = new Map<string, IntradayCacheEntry>();

const INTRADAY_TTL_MS = 60_000;
// Trading-day TTL for daily cache: invalidate after 6h so a fresh session sees new bars.
const DAILY_TTL_MS = 6 * 60 * 60 * 1000;

function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// fetchDailyBars
// ---------------------------------------------------------------------------

export async function fetchDailyBars(
  symbols: string[],
  lookbackDays: number,
): Promise<Map<string, DailyBar[]>> {
  if (symbols.length === 0) return new Map();

  const end = new Date();
  const tradingDay = isoDateUTC(end);
  // Pull a fatter window than `lookbackDays` so weekends/holidays don't truncate
  // (matches data.py:273 — `days * 1.6`).
  const start = new Date(end.getTime() - Math.ceil(lookbackDays * 1.6) * 24 * 3600 * 1000);

  const cacheKey = `${[...symbols].sort().join(",")}|1Day|${tradingDay}|${lookbackDays}`;
  const cached = dailyCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < DAILY_TTL_MS && cached.tradingDay === tradingDay) {
    return cached.bars;
  }

  // L2: ClickHouse. One batched query for the entire universe.
  const l2Result = new Map<string, DailyBar[]>();
  const needFromAlpaca: string[] = [];
  if (isClickhouseEnabled()) {
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    const batch = await queryBarsMulti(symbols, "1Day", startISO, endISO);
    for (const sym of symbols) {
      const rows = batch.get(sym) ?? [];
      if (enoughDailyFromL2(rows, lookbackDays)) {
        l2Result.set(sym, rows);
      } else {
        needFromAlpaca.push(sym);
      }
    }
  } else {
    needFromAlpaca.push(...symbols);
  }

  const result = new Map<string, DailyBar[]>(l2Result);
  if (needFromAlpaca.length > 0) {
    const fresh = new Map<string, DailyBar[]>();
    try {
      for (const group of chunk(needFromAlpaca, 100)) {
        await pullBars(group, "1Day", start, end, fresh);
      }
    } catch {
      // Fail-open: return whatever (possibly empty) we managed to gather.
      if (result.size === 0 && fresh.size === 0) return new Map();
    }
    // Write fresh Alpaca bars back to CH (fire-and-forget) and merge.
    for (const [sym, bars] of fresh) {
      result.set(sym, bars);
      if (isClickhouseEnabled()) {
        void insertBars(sym, "1Day", bars);
      }
    }
  }

  dailyCache.set(cacheKey, { bars: result, ts: Date.now(), tradingDay });
  return result;
}

// ---------------------------------------------------------------------------
// fetchIntradayBars
// ---------------------------------------------------------------------------

export async function fetchIntradayBars(
  symbols: string[],
  lookbackMin: number,
  timeframe: IntradayTimeframe,
): Promise<Map<string, IntradayBar[]>> {
  if (symbols.length === 0) return new Map();

  const end = new Date();
  const start = new Date(end.getTime() - lookbackMin * 60 * 1000);

  const cacheKey = `${[...symbols].sort().join(",")}|${timeframe}|${lookbackMin}`;
  const cached = intradayCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < INTRADAY_TTL_MS) {
    return cached.bars;
  }

  // L2: ClickHouse. One batched query for the entire universe.
  const l2Result = new Map<string, IntradayBar[]>();
  const needFromAlpaca: string[] = [];
  if (isClickhouseEnabled()) {
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    const batch = (await queryBarsMulti(symbols, timeframe, startISO, endISO)) as Map<string, IntradayBar[]>;
    for (const sym of symbols) {
      const rows = batch.get(sym) ?? [];
      if (enoughIntradayFromL2(rows, lookbackMin, timeframe)) {
        l2Result.set(sym, rows);
      } else {
        needFromAlpaca.push(sym);
      }
    }
  } else {
    needFromAlpaca.push(...symbols);
  }

  const result = new Map<string, IntradayBar[]>(l2Result);
  if (needFromAlpaca.length > 0) {
    const fresh = new Map<string, IntradayBar[]>();
    try {
      for (const group of chunk(needFromAlpaca, 100)) {
        await pullBars(group, timeframe, start, end, fresh);
      }
    } catch {
      if (result.size === 0 && fresh.size === 0) return new Map();
    }
    for (const [sym, bars] of fresh) {
      result.set(sym, bars);
      if (isClickhouseEnabled()) {
        void insertBars(sym, timeframe, bars);
      }
    }
  }

  intradayCache.set(cacheKey, { bars: result, ts: Date.now() });
  return result;
}

// ---------------------------------------------------------------------------
// Shared paged fetch
// ---------------------------------------------------------------------------

async function pullBars(
  group: string[],
  timeframe: string,
  start: Date,
  end: Date,
  sink: Map<string, DailyBar[]> | Map<string, IntradayBar[]>,
): Promise<void> {
  let pageToken: string | null = null;
  try {
    for (;;) {
      const params = new URLSearchParams({
        symbols: group.join(","),
        timeframe,
        start: start.toISOString(),
        end: end.toISOString(),
        limit: "10000",
        adjustment: "all",
        feed: feed(),
      });
      if (pageToken) params.set("page_token", pageToken);

      const res = await fetch(`${DATA_BASE}/stocks/bars?${params.toString()}`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (!res.ok) {
        throw new AlpacaBarsError(
          `alpaca bars failed: ${res.status} ${res.statusText}`,
          res.status,
        );
      }
      const data = (await res.json()) as BarsResponse;
      const bars = data.bars ?? {};
      for (const sym of Object.keys(bars)) {
        const list = bars[sym];
        if (!list || list.length === 0) continue;
        const existing = sink.get(sym) ?? [];
        for (const b of list) {
          existing.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: b.vw });
        }
        sink.set(sym, existing);
      }
      pageToken = data.next_page_token;
      if (!pageToken) break;
    }
    recordAlpacaFetch(true);
  } catch (err) {
    recordAlpacaFetch(false);
    if (err instanceof Error) {
      recordError({ kind: "alpaca", message: err.message, stack: err.stack });
    } else {
      recordError({ kind: "alpaca", message: String(err) });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Derived features  (ports data.py:111-186 + engine.py:629-633)
// ---------------------------------------------------------------------------

function ret(closes: number[], days: number): number | null {
  // data.py:119-122 — closes[-1]/closes[-1-days] - 1
  const n = closes.length;
  if (n > days && closes[n - 1 - days] > 0) {
    return closes[n - 1] / closes[n - 1 - days] - 1.0;
  }
  return null;
}

function olsSlope(ys: number[]): number | null {
  // data.py:135-145 — OLS slope, normalized per bar.
  const m = ys.length;
  if (m < 2) return null;
  const xs: number[] = [];
  for (let i = 0; i < m; i++) xs.push(i);
  const xbar = xs.reduce((a, b) => a + b, 0) / m;
  const ybar = ys.reduce((a, b) => a + b, 0) / m;
  let num = 0;
  let den = 0;
  for (let i = 0; i < m; i++) {
    num += (xs[i] - xbar) * (ys[i] - ybar);
    den += (xs[i] - xbar) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

// Roll (1984 JoF) bid-ask bounce correction on close-to-close variance.
// Bar closes alternate between bid and ask, inducing spurious negative
// first-order autocorrelation. Downstream volAnn is currently biased upward
// on wide-spread names, inflating C_side inside gate.ts. Applied only when
// SIGNAL_BOUNCE_CORRECTION=on AND the caller passes a spread.
const BOUNCE_CORRECTION_ENABLED = process.env.SIGNAL_BOUNCE_CORRECTION === "on";

export interface BarFeaturesOpts {
  // Typical spread in bps for the bounce correction. Omit or set 0 to skip.
  spreadBps?: number;
}

export function computeBarFeatures(
  dailyBars: DailyBar[],
  spyDailyBars: DailyBar[] | null,
  intradayBars: IntradayBar[] | null,
  opts: BarFeaturesOpts = {},
): BarFeatures {
  const empty: BarFeatures = {
    ret_3d: null,
    ret_5d: null,
    ret_10d: null,
    ret_prev_5d: null,
    ret_21d: null,
    ret_63d: null,
    ret_126d: null,
    ret_prev_21d: null,
    trend_slope: null,
    sma50: null,
    sma200: null,
    high_60d: null,
    realized_vol_ann: null,
    max_drawdown_60d: null,
    beta_vs_spy: null,
    vol_pct_per_bar: null,
    avg_dollar_vol_20d: null,
  };
  const n = dailyBars.length;
  if (n < 30) return empty; // data.py:116-117

  const closes: number[] = dailyBars.map((b) => b.c);
  const volumes: number[] = dailyBars.map((b) => b.v);

  // ret_21d / 63 / 126 — data.py:124-126
  const r21 = ret(closes, 21);
  const r63 = ret(closes, 63);
  const r126 = ret(closes, 126);
  // short-term lookbacks — ml2/data.py:127-130
  const r3 = ret(closes, 3);
  const r5 = ret(closes, 5);
  const r10 = ret(closes, 10);

  // ret_prev_21d — data.py:128-129
  let rPrev21: number | null = null;
  if (n > 43 && closes[n - 22] > 0 && closes[n - 43] > 0) {
    rPrev21 = closes[n - 22] / closes[n - 43] - 1.0;
  }
  // ret_prev_5d — ml2/data.py:132-137 (5d window before the last, for short_accel)
  let rPrev5: number | null = null;
  if (r5 !== null && n > 10 && closes[n - 6] > 0 && closes[n - 11] > 0) {
    rPrev5 = closes[n - 6] / closes[n - 11] - 1.0;
  }

  // sma50 / sma200 — data.py:131-132
  const sma50 =
    n >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
  const sma200 =
    n >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;

  // high_60d — data.py:133
  const high60 = Math.max(...(n >= 60 ? closes.slice(-60) : closes));

  // trend_slope — data.py:135-145 (OLS slope of log price over last 50 bars)
  const win = n >= 50 ? closes.slice(-50) : closes.slice();
  const logsAll: number[] = [];
  let logsOk = true;
  for (const c of win) {
    if (c > 0) logsAll.push(Math.log(c));
    else {
      logsOk = false;
      break;
    }
  }
  const trendSlope = logsOk && logsAll.length === win.length ? olsSlope(logsAll) : null;

  // daily log returns — data.py:148-149
  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) {
      rets.push(Math.log(closes[i] / closes[i - 1]));
    }
  }

  // realized_vol_ann — data.py:150-154 (stdev of last 20 returns * sqrt(252))
  // Optionally apply Roll (1984 JoF) bid-ask bounce correction when a typical
  // spread is provided: Var(r_corrected) = Var(r) - (s/10000)² / 4.
  let realizedVolAnn: number | null = null;
  if (rets.length >= 20) {
    const recent = rets.slice(-20);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    let varSum = 0;
    for (const r of recent) varSum += (r - mean) ** 2;
    let variance = varSum / Math.max(1, recent.length - 1);
    if (BOUNCE_CORRECTION_ENABLED && opts.spreadBps != null && opts.spreadBps > 0) {
      const s = opts.spreadBps / 10_000;
      variance = Math.max(0, variance - (s * s) / 4);
    }
    realizedVolAnn = Math.sqrt(variance) * Math.sqrt(252);
  }

  // max_drawdown_60d — data.py:156-164 (signed, in [-1, 0])
  let mdd = 0.0;
  {
    const w = n >= 60 ? closes.slice(-60) : closes;
    let peak = w[0];
    for (const c of w) {
      if (c > peak) peak = c;
      if (peak > 0) {
        const dd = c / peak - 1.0;
        if (dd < mdd) mdd = dd;
      }
    }
  }
  const maxDrawdown60d = mdd;

  // avg_dollar_vol_20d — analogous to data.py:166-168 (avg_volume_20d) but in dollars.
  // engine.py:457 / 636 consumes dollar-volume; we pre-multiply close*volume over the
  // last 20 sessions.
  let avgDollarVol20d: number | null = null;
  if (volumes.length >= 20) {
    const lastBars = dailyBars.slice(-20);
    let sum = 0;
    for (const b of lastBars) sum += b.c * b.v;
    avgDollarVol20d = sum / 20;
  }

  // beta_vs_spy — data.py:170-184 (cov(stockRets, spyRets)/var(spyRets), last 90 bars)
  // Spec says 90; the Python uses up to 120. We follow the spec and use 90.
  let beta: number | null = null;
  if (spyDailyBars && spyDailyBars.length >= 30) {
    const spyCloses = spyDailyBars.map((b) => b.c);
    const spyRets: number[] = [];
    for (let i = 1; i < spyCloses.length; i++) {
      if (spyCloses[i] > 0 && spyCloses[i - 1] > 0) {
        spyRets.push(Math.log(spyCloses[i] / spyCloses[i - 1]));
      }
    }
    const kk = Math.min(90, rets.length, spyRets.length);
    if (kk >= 30) {
      const a = rets.slice(-kk);
      const b = spyRets.slice(-kk);
      const ma = a.reduce((x, y) => x + y, 0) / kk;
      const mb = b.reduce((x, y) => x + y, 0) / kk;
      let cov = 0;
      let varb = 0;
      for (let i = 0; i < kk; i++) {
        cov += (a[i] - ma) * (b[i] - mb);
        varb += (b[i] - mb) ** 2;
      }
      cov /= kk;
      varb = varb / kk || 1e-9;
      beta = cov / varb;
    }
  }

  // vol_pct_per_bar — 5-min realized vol expressed as percent.
  // Spec asks for it from intraday bars; engine.py:629-633 derives it from vol_ann
  // (vol_ann * sqrt(5/(60*6.5*252)) * 100). We compute it directly from intraday
  // log-returns when intraday data is available, and fall back to the engine.py
  // formula otherwise.
  let volPctPerBar: number | null = null;
  if (intradayBars && intradayBars.length >= 5) {
    const ic = intradayBars.map((b) => b.c).filter((c) => c > 0);
    const lr: number[] = [];
    for (let i = 1; i < ic.length; i++) lr.push(Math.log(ic[i] / ic[i - 1]));
    if (lr.length >= 5) {
      const mean = lr.reduce((a, b) => a + b, 0) / lr.length;
      let v = 0;
      for (const r of lr) v += (r - mean) ** 2;
      const sd = Math.sqrt(v / Math.max(1, lr.length - 1));
      volPctPerBar = sd * 100.0; // percent per bar
    }
  } else if (realizedVolAnn !== null) {
    const barFrac = 5.0 / (60.0 * 6.5 * 252.0); // engine.py:631
    volPctPerBar = realizedVolAnn * Math.sqrt(barFrac) * 100.0; // engine.py:632
  }

  return {
    ret_3d: r3,
    ret_5d: r5,
    ret_10d: r10,
    ret_prev_5d: rPrev5,
    ret_21d: r21,
    ret_63d: r63,
    ret_126d: r126,
    ret_prev_21d: rPrev21,
    trend_slope: trendSlope,
    sma50,
    sma200,
    high_60d: high60,
    realized_vol_ann: realizedVolAnn,
    max_drawdown_60d: maxDrawdown60d,
    beta_vs_spy: beta,
    vol_pct_per_bar: volPctPerBar,
    avg_dollar_vol_20d: avgDollarVol20d,
  };
}
