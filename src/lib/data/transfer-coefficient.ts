// Transfer Coefficient (TC) monitor.
//
// The Fundamental Law of Active Management (Grinold & Kahn 2000 ch. 6;
// Clarke, de Silva & Thorley 2002, Financial Analysts Journal) decomposes
// realized information ratio as
//   IR ≈ TC · IC · √BR
// where:
//   IC = skill per bet (how well signals predict returns)
//   BR = breadth (independent bets per year)
//   TC = transfer coefficient (correlation of paper ranks to executed ranks)
//
// Without a live TC, a Sharpe drop cannot be root-caused: is it signal decay
// (IC ↓), execution friction (TC ↓), or breadth erosion (BR ↓)? This module
// computes TC weekly (Spearman rank correlation over trailing 21 days) so the
// admin dashboard can attribute Sharpe changes correctly.
//
// TC ∈ [0.30, 0.60] is expected for constrained long-only US equity;
// TC < 0.20 is a friction red flag; TC ≈ 1 is suspicious (means constraints
// don't bind — sizing is likely too small).
//
// Fail-open: returns an empty report when CH is disabled or query fails.

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { recordError } from "./metrics";
import { spearmanRankCorr } from "./family-ic";

export type Horizon = "3d" | "5d" | "10d";

export interface TransferCoefficientPoint {
  horizon: Horizon;
  windowDays: number;
  n: number;
  tc: number;         // Spearman rank corr in [-1, 1]
  interpretation: "healthy" | "friction-heavy" | "under-constrained" | "insufficient-data";
}

export interface TransferCoefficientReport {
  generatedAt: string;
  windowDays: number;
  points: TransferCoefficientPoint[];
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
    console.warn("[transfer-coefficient] client init failed:", err);
    return null;
  }
}

interface JoinedRow {
  horizon: string;
  paper_edge: number;
  executed_edge: number;
}

const HORIZONS: readonly Horizon[] = ["3d", "5d", "10d"] as const;
const MIN_ROWS = 20;

// Compute TC as Spearman rank correlation between paper_edge (what the
// scanner produced pre-gate) and executed_edge (what actually got promoted /
// resolved with a realized return).
//
// Definitions used here (both derivable from existing CH columns):
//   paper_edge    = scan_rows.model_edge — the pre-cost forecast edge
//   executed_edge = shadow_resolved.realized_bps — realized outcome
//
// Ranking both series and correlating tests: "did the ordering the scanner
// wanted match the ordering the market delivered on the names that got in?"
// A high TC means "yes, the ordering translated cleanly"; a low TC means
// the ordering was scrambled by costs / execution / gate filtering.
export async function computeTransferCoefficient(
  windowDays = 21,
): Promise<TransferCoefficientReport> {
  const generatedAt = new Date().toISOString();
  const c = getClient();
  if (!c) return { generatedAt, windowDays, points: [] };

  let rows: JoinedRow[] = [];
  try {
    const rs = await c.query({
      query: `
        SELECT
          ss.horizon           AS horizon,
          sr.model_edge        AS paper_edge,
          shr.realized_bps     AS executed_edge
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
      recordError({ kind: "ch", message: `computeTransferCoefficient(${windowDays}d): ${err.message}`, stack: err.stack });
    }
    return { generatedAt, windowDays, points: [] };
  }

  const points: TransferCoefficientPoint[] = [];
  for (const h of HORIZONS) {
    const hRows = rows.filter((r) => r.horizon === h);
    if (hRows.length < MIN_ROWS) {
      points.push({
        horizon: h,
        windowDays,
        n: hRows.length,
        tc: 0,
        interpretation: "insufficient-data",
      });
      continue;
    }
    const paper = hRows.map((r) => r.paper_edge);
    const executed = hRows.map((r) => r.executed_edge);
    const tc = spearmanRankCorr(paper, executed);
    points.push({
      horizon: h,
      windowDays,
      n: hRows.length,
      tc: round4(tc),
      interpretation: interpretTC(tc),
    });
  }

  return { generatedAt, windowDays, points };
}

function interpretTC(tc: number): TransferCoefficientPoint["interpretation"] {
  if (tc < 0.20) return "friction-heavy";
  if (tc > 0.85) return "under-constrained";
  return "healthy";
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
