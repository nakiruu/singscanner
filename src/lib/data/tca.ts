// Transaction Cost Analysis (TCA) panel.
//
// Compares the gate's modeled cost to realized Δnet_bps observed at horizon
// resolution. The gate emits `model_edge` and `net` per scan row; their
// difference (`model_edge - net`) is the total modeled cost stack — impact,
// spread, queue, memory, concentration. Post-resolution `realized_bps` from
// shadow_resolved is the true forward return. The residual
//   residual = realized_bps - modeled_cost_bps
// isolates where the cost model is systematically under- or over-quoting.
//
// Buckets by (session-of-day, horizon, liquidity_bucket) and reports
// n / meanResidual / stdResidual / tStat per cell. Cells with |tStat| > 2
// are surfaced as coefficient-tuning candidates.
//
// Fail-open: returns an empty report when CH is disabled or the query fails.

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { recordError } from "./metrics";

// Canonical SessionBucket enum — see src/lib/engine/session-bucket.ts.
export { type SessionBucket } from "@/lib/engine/session-bucket";
import type { SessionBucket } from "@/lib/engine/session-bucket";
export type Horizon = "3d" | "5d" | "10d";
export type LiquidityBucket = "megacap" | "largecap" | "midcap" | "smallcap";

export interface TCACell {
  session: SessionBucket;
  horizon: Horizon;
  liquidityBucket: LiquidityBucket;
  n: number;
  meanModeledCostBps: number;
  meanRealizedDeltaBps: number;
  residualBps: number;      // realized - modeled
  residualStd: number;
  tStat: number;            // residual / (std / sqrt(n))
}

export interface TCARecommendation {
  constant: string;
  currentValue: number;
  suggestedValue: number;
  evidenceCellCount: number;
  confidence: "low" | "medium" | "high";
  reason: string;
}

export interface TCAReport {
  generatedAt: string;
  windowDays: number;
  cells: TCACell[];
  summary: {
    totalObservations: number;
    worstResidualCell: TCACell | null;
    coefficientRecommendations: TCARecommendation[];
  };
}

export interface TCAOpts {
  windowDays?: number;   // default 30
  minCellN?: number;     // default 20 — cells below drop from report
  // Bucketing on `scan_rows.liquidity` (cross-sectional percentile rank 0-100),
  // NOT raw dollar volume — scan_rows does not persist ADV. Default splits at
  // 75/50/25 percentiles.
  liquidityBucketFn?: (liquidityPct: number) => LiquidityBucket;
}

// Local CH client — matches per-file convention.
let client: ClickHouseClient | null = null;
let initialized = false;

function getClient(): ClickHouseClient | null {
  if (initialized) return client;
  initialized = true;
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  try {
    client = createClient({
      url,
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DB ?? "default",
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
    return client;
  } catch (err) {
    console.warn("[tca] client init failed:", err);
    return null;
  }
}

interface JoinedRow {
  horizon: string;
  symbol: string;
  hour_of_day: number;
  liquidity_pct: number;  // cross-sectional percentile from scan_rows.liquidity
  model_edge: number;
  net: number;
  realized_bps: number;
}

const HORIZONS: readonly Horizon[] = ["3d", "5d", "10d"] as const;

export async function computeTCA(opts: TCAOpts = {}): Promise<TCAReport> {
  const windowDays = opts.windowDays ?? 30;
  const minCellN = opts.minCellN ?? 20;
  const liquidityBucket = opts.liquidityBucketFn ?? defaultLiquidityBucket;
  const generatedAt = new Date().toISOString();

  const c = getClient();
  if (!c) {
    return emptyReport(generatedAt, windowDays);
  }

  let rows: JoinedRow[] = [];
  try {
    const rs = await c.query({
      query: `
        SELECT
          ss.horizon                                       AS horizon,
          sr.symbol                                        AS symbol,
          toHour(toTimeZone(ss.generated_at, 'America/New_York')) AS hour_of_day,
          sr.liquidity                                     AS liquidity_pct,
          sr.model_edge                                    AS model_edge,
          sr.net                                           AS net,
          shr.realized_bps                                 AS realized_bps
        FROM scan_rows sr
        INNER JOIN scan_snapshots ss ON ss.id = sr.snapshot_id
        INNER JOIN shadow_resolved shr
          ON shr.symbol = sr.symbol
         AND shr.horizon = ss.horizon
         AND shr.submitted_at = ss.generated_at
        WHERE shr.resolved_at >= now() - INTERVAL {windowDays:UInt16} DAY
          AND shr.clean = 1
          AND sr.model_edge > sr.net
      `,
      query_params: { windowDays },
      format: "JSONEachRow",
    });
    rows = (await rs.json()) as JoinedRow[];
  } catch (err) {
    if (err instanceof Error) {
      recordError({ kind: "ch", message: `computeTCA(${windowDays}d): ${err.message}`, stack: err.stack });
    }
    return emptyReport(generatedAt, windowDays);
  }

  // Bucket rows by (session, horizon, liquidity).
  interface Sample { modeled: number; realized: number }
  const bucketed = new Map<string, Sample[]>();
  for (const r of rows) {
    if (!HORIZONS.includes(r.horizon as Horizon)) continue;
    const session = sessionFromHour(r.hour_of_day);
    const liq = liquidityBucket(r.liquidity_pct);
    const key = `${session}|${r.horizon}|${liq}`;
    const modeled = r.model_edge - r.net; // total modeled cost stack, bps
    const arr = bucketed.get(key) ?? [];
    arr.push({ modeled, realized: r.realized_bps });
    bucketed.set(key, arr);
  }

  const cells: TCACell[] = [];
  for (const [key, arr] of bucketed) {
    if (arr.length < minCellN) continue;
    const parts = key.split("|");
    const session = parts[0] as SessionBucket;
    const horizon = parts[1] as Horizon;
    const liq = parts[2] as LiquidityBucket;
    const n = arr.length;
    const meanModeled = arr.reduce((s, x) => s + x.modeled, 0) / n;
    const meanRealized = arr.reduce((s, x) => s + x.realized, 0) / n;
    const residual = meanRealized - meanModeled;
    const residuals = arr.map((x) => x.realized - x.modeled);
    const residualVar = n > 1
      ? residuals.reduce((s, x) => s + (x - residual) * (x - residual), 0) / (n - 1)
      : 0;
    const residualStd = Math.sqrt(Math.max(0, residualVar));
    const tStat = residualStd > 0 ? residual / (residualStd / Math.sqrt(n)) : 0;
    cells.push({
      session,
      horizon,
      liquidityBucket: liq,
      n,
      meanModeledCostBps: round2(meanModeled),
      meanRealizedDeltaBps: round2(meanRealized),
      residualBps: round2(residual),
      residualStd: round2(residualStd),
      tStat: round2(tStat),
    });
  }

  const worstResidualCell = cells.reduce<TCACell | null>(
    (worst, c) => (Math.abs(c.residualBps) > (worst ? Math.abs(worst.residualBps) : 0) ? c : worst),
    null,
  );

  const recommendations = suggestCoefficientChanges(cells);

  return {
    generatedAt,
    windowDays,
    cells,
    summary: {
      totalObservations: rows.length,
      worstResidualCell,
      coefficientRecommendations: recommendations,
    },
  };
}

// -- Helpers -----------------------------------------------------------------

export function sessionFromHour(hourET: number): SessionBucket {
  // Matches src/lib/shadow/features.ts sessionBucketNow bucketing without
  // needing weekday context (TCA windows filter clean rows, not calendar).
  if (hourET >= 9 && hourET < 16) return "regular";     // 9-15:59 ET
  if (hourET >= 4 && hourET < 9) return "premarket";     // 4-8:59 ET
  if (hourET >= 16 && hourET < 20) return "afterhours"; // 16-19:59 ET
  return "closed";
}

// scan_rows.liquidity is a cross-sectional percentile (typically 0-100),
// not raw $ADV — bucket splits mirror the equal-quartile convention used in
// admin dashboards. If future work adds raw ADV to scan_rows, callers can
// pass a custom liquidityBucketFn.
export function defaultLiquidityBucket(liquidityPct: number): LiquidityBucket {
  if (liquidityPct >= 75) return "megacap";
  if (liquidityPct >= 50) return "largecap";
  if (liquidityPct >= 25) return "midcap";
  return "smallcap";
}

function suggestCoefficientChanges(cells: TCACell[]): TCARecommendation[] {
  const recs: TCARecommendation[] = [];

  // SQRT_IMPACT_COEFF: small/mid-cap regular-session cells consistently under-model.
  // Look for cells with |tStat| > 2 AND realized > modeled (positive residual).
  const midcapCells = cells.filter(
    (c) => (c.liquidityBucket === "smallcap" || c.liquidityBucket === "midcap")
      && c.session === "regular"
      && Math.abs(c.tStat) > 2
      && c.meanModeledCostBps > 0,
  );
  if (midcapCells.length >= 2) {
    const meanRatio = midcapCells.reduce(
      (s, c) => s + (c.meanRealizedDeltaBps / Math.max(1, c.meanModeledCostBps)),
      0,
    ) / midcapCells.length;
    if (meanRatio > 1.5) {
      recs.push({
        constant: "SQRT_IMPACT_COEFF",
        currentValue: 9,
        suggestedValue: Math.round(9 * meanRatio),
        evidenceCellCount: midcapCells.length,
        confidence: midcapCells.length >= 4 ? "high" : "medium",
        reason: `Small/mid-cap regular-session cells show realized cost ${meanRatio.toFixed(1)}× modeled — SQRT_IMPACT_COEFF likely under-calibrated (Bouchaud et al. 2018, ch. 12).`,
      });
    }
  }

  // Session multipliers: extended/closed cells with residual >> regular baseline.
  const regularBaseByCell = new Map<string, number>();
  for (const c of cells) {
    if (c.session === "regular") {
      regularBaseByCell.set(`${c.horizon}|${c.liquidityBucket}`, c.residualBps);
    }
  }
  const nonRegular = cells.filter(
    (c) => c.session !== "regular" && Math.abs(c.tStat) > 2,
  );
  for (const c of nonRegular) {
    const base = regularBaseByCell.get(`${c.horizon}|${c.liquidityBucket}`) ?? 0;
    const excess = c.residualBps - base;
    if (Math.abs(excess) > 20) {
      const constantName = c.session === "premarket" || c.session === "afterhours"
        ? `sessionExtended[${c.horizon}]`
        : `sessionClosed[${c.horizon}]`;
      recs.push({
        constant: constantName,
        currentValue: 0,
        suggestedValue: 0,
        evidenceCellCount: 1,
        confidence: "low",
        reason: `${c.session} cell ${c.horizon}/${c.liquidityBucket} residual = ${excess.toFixed(1)} bps beyond regular baseline; consider raising ${constantName} (Barclay-Hendershott 2003).`,
      });
    }
  }

  return recs;
}

function emptyReport(generatedAt: string, windowDays: number): TCAReport {
  return {
    generatedAt,
    windowDays,
    cells: [],
    summary: {
      totalObservations: 0,
      worstResidualCell: null,
      coefficientRecommendations: [],
    },
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
