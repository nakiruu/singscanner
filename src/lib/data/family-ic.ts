// Per-family, per-horizon rolling Information Coefficient (IC).
//
// IC_f,h(t) = Spearman rank correlation between the family score at scan-time
// and the realized Δnet_bps at horizon resolution, over a trailing 63-day
// window (Grinold & Kahn 2000, ch. 5).
//
// Reads scan_rows joined with shadow_resolved. Fail-open: returns empty
// report when CH is disabled or the query errors. Nothing here writes to CH.

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { recordError } from "./metrics";

// Local CH client — matches the per-file convention in shadow/persistence.ts
// and data/clickhouse.ts. Silent no-op when CLICKHOUSE_URL is unset.
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
    console.warn("[family-ic] client init failed:", err);
    return null;
  }
}

export type SignalFamily = "momentum" | "quality" | "liquidity" | "risk";
export type Horizon = "3d" | "5d" | "10d";

export interface FamilyICPoint {
  family: SignalFamily;
  horizon: Horizon;
  windowDays: number;
  n: number;
  ic: number;          // Spearman rank correlation ∈ [-1, 1]
  icTStat: number;     // ic · √(n-2) / √(1-ic²)
  significant: boolean; // |icTStat| > 2
}

export interface FamilyICReport {
  generatedAt: string; // ISO8601
  windowDays: number;
  points: FamilyICPoint[];
}

interface JoinedRow {
  horizon: string;
  symbol: string;
  momentum: number;
  quality: number;
  liquidity: number;
  risk: number;
  realized_bps: number;
}

const FAMILIES: SignalFamily[] = ["momentum", "quality", "liquidity", "risk"];
const HORIZONS: Horizon[] = ["3d", "5d", "10d"];

const MIN_ROWS_PER_CELL = 20;

export async function computeFamilyIC(windowDays = 63): Promise<FamilyICReport> {
  const generatedAt = new Date().toISOString();
  const c = getClient();
  if (!c) return { generatedAt, windowDays, points: [] };

  let rows: JoinedRow[] = [];
  try {
    const rs = await c.query({
      query: `
        SELECT
          ss.horizon      AS horizon,
          sr.symbol       AS symbol,
          sr.momentum     AS momentum,
          sr.quality      AS quality,
          sr.liquidity    AS liquidity,
          sr.risk         AS risk,
          shr.realized_bps AS realized_bps
        FROM scan_rows sr
        INNER JOIN scan_snapshots ss ON ss.id = sr.snapshot_id
        INNER JOIN shadow_resolved shr
          ON shr.symbol = sr.symbol
         AND shr.horizon = ss.horizon
         AND shr.submitted_at = ss.generated_at
        WHERE shr.resolved_at >= now() - INTERVAL {windowDays:UInt16} DAY
          AND shr.clean = 1
      `,
      query_params: { windowDays },
      format: "JSONEachRow",
    });
    rows = (await rs.json()) as JoinedRow[];
  } catch (err) {
    if (err instanceof Error) {
      recordError({ kind: "ch", message: `computeFamilyIC(${windowDays}d): ${err.message}`, stack: err.stack });
    }
    return { generatedAt, windowDays, points: [] };
  }

  const points: FamilyICPoint[] = [];
  for (const h of HORIZONS) {
    const hRows = rows.filter((r) => r.horizon === h);
    if (hRows.length < MIN_ROWS_PER_CELL) continue;

    const returns = hRows.map((r) => r.realized_bps);
    for (const family of FAMILIES) {
      const scores = hRows.map((r) => r[family]);
      const ic = spearmanRankCorr(scores, returns);
      const n = hRows.length;
      const tStat = safeICTStat(ic, n);
      points.push({
        family,
        horizon: h,
        windowDays,
        n,
        ic: round4(ic),
        icTStat: round2(tStat),
        significant: Math.abs(tStat) > 2,
      });
    }
  }

  return { generatedAt, windowDays, points };
}

// -- Pure helpers (exported for testability once a test framework lands) ------

export function spearmanRankCorr(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3 || xs.length !== ys.length) return 0;
  const rankX = rankArray(xs);
  const rankY = rankArray(ys);
  const meanRx = rankX.reduce((a, b) => a + b, 0) / n;
  const meanRy = rankY.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = rankX[i] - meanRx;
    const dy = rankY[i] - meanRy;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX <= 0 || denY <= 0) return 0;
  const r = num / Math.sqrt(denX * denY);
  // Clamp against float drift so |r| ≤ 1.
  return Math.max(-1, Math.min(1, r));
}

// Ties: assign average rank across the tied range (standard Spearman treatment).
export function rankArray(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length - 1 && indexed[j + 1].v === indexed[i].v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = rank;
    i = j + 1;
  }
  return ranks;
}

function safeICTStat(ic: number, n: number): number {
  if (n < 3) return 0;
  const denom = 1 - ic * ic;
  if (denom <= 1e-9) return ic > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  return (ic * Math.sqrt(n - 2)) / Math.sqrt(denom);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
