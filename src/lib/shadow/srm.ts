// Sample-Ratio Mismatch (SRM) canary for the shadow monitor.
//
// SRM = "the two arms of an A/B test are receiving unequal numbers of
// observations even though the assignment mechanism should split them 50/50."
// It's the single most common invalidator of A/B tests at industrial scale —
// 6-10% of Microsoft experiments (Fabijan et al. 2019 KDD; Kohavi et al.
// 2013 KDD).
//
// In singscanner's shadow monitor, the baseline and challenger BOTH see
// every scan row — so if their counts of resolved observations diverge, a
// dedup/persistence bug is silently dropping one side. Chi-square goodness-
// of-fit against a 50/50 expected split gives us a p-value; alarm at
// p < 0.001 (standard industrial SRM alarm threshold).
//
// Reads shadow_resolved. Fail-open: returns null when CH is disabled.

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { recordError } from "@/lib/data/metrics";

export type Horizon = "3d" | "5d" | "10d";

export interface SrmResult {
  horizon: Horizon;
  windowDays: number;
  baselineCount: number;
  challengerCount: number;
  expectedEach: number;
  chi2: number;
  pValue: number;
  alarm: boolean;   // true iff pValue < ALARM_P
}

const ALARM_P = 0.001;
const MIN_COUNT = 50;   // don't fire on small samples

// Local CH client — matches the per-file convention in shadow/persistence.ts.
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
    console.warn("[srm] client init failed:", err);
    return null;
  }
}

// SRM check: for each resolved horizon, count rows where the baseline
// arm was the "primary decision" (baseline_decision != none) vs the
// challenger arm.
//
// The canonical SRM test compares observed vs expected split. Under the
// null (no bug), both arms observe every eligible row so expected ratio
// is 1:1. We use chi-square with 1 degree of freedom.
export async function srmChiSquare(
  horizon: Horizon,
  windowDays = 7,
): Promise<SrmResult | null> {
  const c = getClient();
  if (!c) return null;

  try {
    const rs = await c.query({
      query: `
        SELECT
          countIf(baseline_decision != 'HOLD-CASH') AS baseline_count,
          countIf(challenger_decision != 'HOLD-CASH') AS challenger_count
        FROM shadow_resolved
        WHERE horizon = {horizon:String}
          AND resolved_at >= now() - INTERVAL {windowDays:UInt16} DAY
          AND clean = 1
      `,
      query_params: { horizon, windowDays },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as Array<{
      baseline_count: number | string;
      challenger_count: number | string;
    }>;
    if (rows.length === 0) return null;
    const baselineCount = Number(rows[0].baseline_count) || 0;
    const challengerCount = Number(rows[0].challenger_count) || 0;
    const total = baselineCount + challengerCount;

    if (total < MIN_COUNT) {
      return {
        horizon,
        windowDays,
        baselineCount,
        challengerCount,
        expectedEach: total / 2,
        chi2: 0,
        pValue: 1,
        alarm: false,
      };
    }

    const expected = total / 2;
    const chi2 =
      ((baselineCount - expected) ** 2) / expected
      + ((challengerCount - expected) ** 2) / expected;
    const pValue = chi2SurvivalOneDoF(chi2);

    return {
      horizon,
      windowDays,
      baselineCount,
      challengerCount,
      expectedEach: expected,
      chi2,
      pValue,
      alarm: pValue < ALARM_P,
    };
  } catch (err) {
    if (err instanceof Error) {
      recordError({ kind: "ch", message: `srmChiSquare(${horizon}, ${windowDays}d): ${err.message}`, stack: err.stack });
    }
    return null;
  }
}

// -- Helpers -----------------------------------------------------------------

// Chi-square survival function P(X² > x) for 1 degree of freedom.
// Uses the closed-form relation for χ²(1): P(X² > x) = 2·(1 - Φ(√x))
// where Φ is the standard normal CDF. Approximation via Abramowitz-Stegun
// 26.2.17 (accurate to ~1e-6).
function chi2SurvivalOneDoF(x: number): number {
  if (x <= 0) return 1;
  const z = Math.sqrt(x);
  return 2 * (1 - normalCdf(z));
}

function normalCdf(z: number): number {
  // Abramowitz-Stegun 26.2.17
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - d * poly;
  return z >= 0 ? cdf : 1 - cdf;
}
