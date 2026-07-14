// Cross-horizon portfolio aggregation.
//
// The scanner runs three independent horizon lanes (3d / 5d / 10d). Without
// aggregation, a single symbol can be `primary` in multiple lanes and end up
// carrying (per-lane × lanes) NAV — realized 3d/5d/10d returns on the same
// name are 0.5-0.8 correlated (Grinold & Kahn 2000, ch. 5), so aggregate risk
// ≈ sum, not sqrt(sum²).
//
// This module folds the three per-lane target books into a single aggregate
// view, applies an aggregate soft-cap penalty and hard per-name cap, and
// returns both the aggregate weights and the per-horizon breakdown for
// admin observability. No hot-path behavior change unless
// PORTFOLIO_AGGREGATE_ENABLED is wired into the scanner.

import type { PortfolioBuildResult, TargetWeight } from "./portfolio";

// Horizon keys used in the ladder. Kept as a local literal type since
// engine/types.ts does not export a shared Horizon union.
export type AggregateHorizon = "3d" | "5d" | "10d";

export interface AggregateWeight {
  symbol: string;
  // Fraction of NAV across the whole book (single-book normalization; the
  // three lanes share one NAV, so a per-lane weight of 0.30 contributes 0.10
  // to the aggregate under equal-lane weighting).
  aggregateWeight: number;
  // Per-lane breakdown so the admin UI can attribute an aggregate name.
  perHorizon: Partial<Record<AggregateHorizon, TargetWeight>>;
  // Aggregate concentration penalty in bps (over aggregateComfortableWeight).
  aggregateConcentrationBps: number;
  // Set when pre-clip aggregate weight would have exceeded aggregateMaxNameWeight.
  overCap: boolean;
}

export interface AggregatePortfolioResult {
  weights: AggregateWeight[];
  aggregateCashWeight: number;
  perHorizon: Partial<Record<AggregateHorizon, PortfolioBuildResult>>;
}

export interface AggregateOpts {
  // Soft cap. Aggregate weight above this triggers a bps penalty for the gate.
  aggregateComfortableWeight: number;
  // Hard cap on aggregate exposure per name. Water-fills overflow into
  // uncapped names.
  aggregateMaxNameWeight: number;
  // Bps per unit of squared aggregate overweight — mirrors portfolio.ts.
  aggregateConcentrationScale: number;
  // Per-lane blend weight. Defaults to equal weighting (1/3 per lane) when
  // three lanes are supplied; auto-normalized against the lanes actually
  // present in `byHorizon`.
  laneWeights?: Partial<Record<AggregateHorizon, number>>;
}

const DEFAULT_AGG_OPTS: AggregateOpts = {
  aggregateComfortableWeight: 0.20,
  aggregateMaxNameWeight: 0.15,
  aggregateConcentrationScale: 300,
};

// Water-fill projection: clip any aggregate weight above cap, redistribute
// overflow proportionally into uncapped names. Mirrors portfolio.ts helper.
function projectToMaxWeight(weights: number[], cap: number): number[] {
  if (cap <= 0 || !Number.isFinite(cap)) return weights.slice();
  const w = weights.slice();
  const isCapped = new Array(w.length).fill(false);
  for (let iter = 0; iter < 10; iter++) {
    let overflow = 0;
    for (let i = 0; i < w.length; i++) {
      if (!isCapped[i] && w[i] > cap) {
        overflow += w[i] - cap;
        w[i] = cap;
        isCapped[i] = true;
      }
    }
    if (overflow === 0) break;
    let openMass = 0;
    for (let i = 0; i < w.length; i++) if (!isCapped[i]) openMass += w[i];
    if (openMass === 0) break;
    for (let i = 0; i < w.length; i++) {
      if (!isCapped[i]) w[i] += overflow * (w[i] / openMass);
    }
  }
  return w;
}

export function aggregatePortfolios(
  byHorizon: Partial<Record<AggregateHorizon, PortfolioBuildResult>>,
  opts: Partial<AggregateOpts> = {},
): AggregatePortfolioResult {
  const o = { ...DEFAULT_AGG_OPTS, ...opts };

  // Establish the effective lane-weighting. Defaults to equal weighting over
  // the lanes actually present so callers with 1 or 2 lanes still get sensible
  // aggregate math.
  const presentHorizons = (Object.keys(byHorizon) as AggregateHorizon[]).filter(
    (h) => byHorizon[h] != null,
  );
  if (presentHorizons.length === 0) {
    return { weights: [], aggregateCashWeight: 1, perHorizon: {} };
  }
  const rawLaneWeights: Record<AggregateHorizon, number> = { "3d": 0, "5d": 0, "10d": 0 };
  let laneSum = 0;
  for (const h of presentHorizons) {
    const lw = o.laneWeights?.[h] ?? 1;
    rawLaneWeights[h] = lw;
    laneSum += lw;
  }
  if (laneSum <= 0) {
    return { weights: [], aggregateCashWeight: 1, perHorizon: byHorizon };
  }
  const laneWeights: Record<AggregateHorizon, number> = {
    "3d": rawLaneWeights["3d"] / laneSum,
    "5d": rawLaneWeights["5d"] / laneSum,
    "10d": rawLaneWeights["10d"] / laneSum,
  };

  // Sum per-symbol contributions across present lanes.
  const bySymbol = new Map<string, AggregateWeight>();
  for (const h of presentHorizons) {
    const result = byHorizon[h];
    if (!result) continue;
    for (const w of result.weights) {
      const existing = bySymbol.get(w.symbol) ?? {
        symbol: w.symbol,
        aggregateWeight: 0,
        perHorizon: {} as Partial<Record<AggregateHorizon, TargetWeight>>,
        aggregateConcentrationBps: 0,
        overCap: false,
      };
      existing.aggregateWeight += w.targetWeight * laneWeights[h];
      existing.perHorizon[h] = w;
      bySymbol.set(w.symbol, existing);
    }
  }

  const arr = Array.from(bySymbol.values());
  if (arr.length === 0) {
    return { weights: [], aggregateCashWeight: 1, perHorizon: byHorizon };
  }

  // Flag pre-clip overcap so admin observability can count how often the hard
  // cap actually binds.
  for (const a of arr) {
    if (a.aggregateWeight > o.aggregateMaxNameWeight) a.overCap = true;
  }

  const weights = arr.map((a) => a.aggregateWeight);
  const capped = projectToMaxWeight(weights, o.aggregateMaxNameWeight);
  arr.forEach((a, i) => {
    a.aggregateWeight = capped[i];
    const over = Math.max(0, capped[i] - o.aggregateComfortableWeight);
    a.aggregateConcentrationBps = o.aggregateConcentrationScale * over * over;
  });

  const totalAllocated = capped.reduce((s, x) => s + x, 0);
  const aggregateCashWeight = Math.max(0, 1 - totalAllocated);

  return {
    weights: arr,
    aggregateCashWeight,
    perHorizon: byHorizon,
  };
}
