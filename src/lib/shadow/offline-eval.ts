// Offline evaluation harness.
//
// Ties together the three P0/P1/B4 statistical hardening modules into one
// callable orchestrator for hyperparameter tuning against shadow_resolved:
//
//   1. Purged rolling-origin CV (B4-A1 purged-cv.ts) generates fold windows
//      with an embargo ≥ largest horizon in the ladder.
//   2. For each config × fold, a caller-supplied scoreFn computes the
//      config's out-of-sample Sharpe (typically δ_post / SE(δ_post) on the
//      test slice).
//   3. PBO diagnostic (B4-S4 pbo.ts) tests whether the winning config
//      generalizes vs the OOS median.
//   4. DSR (P1a #4 dsr.ts) adjusts the winning Sharpe for the multiple-
//      testing penalty of a grid search.
//
// Refuses to run if the fold structure would leak labels across the
// 3d/5d/10d horizons — embargoDays must be ≥ max horizon.
//
// Pure orchestrator — no CH, no I/O of its own. Caller supplies data
// windows + scoreFn.

import {
  makePurgedFolds,
  type CVConfig,
  type CVFold,
} from "./eval/purged-cv";
import { computePBO } from "./eval/pbo";
import { deflatedSharpeRatio } from "./dsr";

export type Horizon = "3d" | "5d" | "10d";

export interface OfflineEvalOpts<TConfig> {
  horizon: Horizon;
  windowStart: string;   // ISO date
  windowEnd: string;     // ISO date
  configs: readonly TConfig[];
  scoreFn: (config: TConfig, fold: CVFold) => Promise<number>;   // Sharpe
  nFolds?: number;       // default 5
  embargoDays?: number;  // must be ≥ horizon days; default = horizon
}

export interface OfflineEvalReport<TConfig> {
  generatedAt: string;
  horizon: Horizon;
  nConfigs: number;
  nFolds: number;
  folds: CVFold[];
  scoreMatrix: number[][];      // scoreMatrix[foldIdx][configIdx]
  perConfig: Array<{
    config: TConfig;
    meanScore: number;
    stdScore: number;
    dsr: number;
  }>;
  winner: {
    config: TConfig;
    rawSharpe: number;
    deflatedSharpe: number;
  };
  pbo: {
    value: number;
    interpretation: "acceptable" | "risky" | "invalidating";
    performanceDegradation: number;
  };
  warnings: string[];
}

const HORIZON_DAYS: Record<Horizon, number> = { "3d": 3, "5d": 5, "10d": 10 };

export async function runOfflineEval<TConfig>(
  opts: OfflineEvalOpts<TConfig>,
): Promise<OfflineEvalReport<TConfig>> {
  const generatedAt = new Date().toISOString();
  const warnings: string[] = [];
  const requiredEmbargo = HORIZON_DAYS[opts.horizon];
  const embargoDays = opts.embargoDays ?? requiredEmbargo;
  const nFolds = opts.nFolds ?? 5;

  if (embargoDays < requiredEmbargo) {
    throw new Error(
      `offline-eval: embargoDays=${embargoDays} < ${requiredEmbargo} for horizon ${opts.horizon}; ` +
      `fold structure would leak labels across the forward-return window.`,
    );
  }

  // 1. Fold generation via purged rolling-origin CV.
  const cvCfg: CVConfig = {
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,
    nFolds,
    embargoDays,
  };
  const folds = makePurgedFolds(cvCfg);
  if (folds.length < 2) {
    throw new Error(
      `offline-eval: fold generator produced only ${folds.length} folds; ` +
      `check windowStart/windowEnd/embargoDays sizing.`,
    );
  }

  // 2. Score matrix [foldIdx][configIdx]. Serial evaluation — caller's
  // scoreFn typically hits CH so parallelism can overwhelm the client.
  const scoreMatrix: number[][] = [];
  for (const fold of folds) {
    const row: number[] = [];
    for (const cfg of opts.configs) {
      row.push(await opts.scoreFn(cfg, fold));
    }
    scoreMatrix.push(row);
  }

  // 3. Per-config summary + DSR (against the number of configs tested).
  const nConfigs = opts.configs.length;
  const perConfig = opts.configs.map((cfg, cIdx) => {
    const foldScores = scoreMatrix.map((row) => row[cIdx]);
    const meanScore = foldScores.reduce((s, x) => s + x, 0) / foldScores.length;
    const variance =
      foldScores.reduce((s, x) => s + (x - meanScore) ** 2, 0)
      / Math.max(1, foldScores.length - 1);
    const stdScore = Math.sqrt(Math.max(0, variance));
    // DSR uses observed Sharpe (mean fold score is a per-fold Sharpe
    // already; caller decides how to aggregate) and N = number of trials.
    const dsr = deflatedSharpeRatio(meanScore, nConfigs);
    return { config: cfg, meanScore, stdScore, dsr };
  });

  // 4. Winner + PBO.
  let winnerIdx = 0;
  for (let i = 1; i < perConfig.length; i++) {
    if (perConfig[i].meanScore > perConfig[winnerIdx].meanScore) winnerIdx = i;
  }
  const winner = perConfig[winnerIdx];

  // PBO requires an even number of slices. Trim to the largest even count.
  const evenFolds = folds.length - (folds.length % 2);
  let pboResult;
  if (evenFolds >= 4) {
    const trimmedMatrix = scoreMatrix.slice(0, evenFolds);
    pboResult = computePBO({ scoreMatrix: trimmedMatrix });
  } else {
    warnings.push(
      `PBO skipped: only ${folds.length} folds (need ≥ 4 even for combinatorial split)`,
    );
    pboResult = { pbo: 0, performanceDegradation: 0, nSplits: 0, nSlices: 0, nConfigs, logits: [] };
  }
  const pboInterpretation: "acceptable" | "risky" | "invalidating" =
    pboResult.pbo > 0.5 ? "invalidating"
    : pboResult.pbo > 0.3 ? "risky"
    : "acceptable";

  return {
    generatedAt,
    horizon: opts.horizon,
    nConfigs,
    nFolds: folds.length,
    folds,
    scoreMatrix,
    perConfig,
    winner: {
      config: winner.config,
      rawSharpe: winner.meanScore,
      deflatedSharpe: winner.dsr,
    },
    pbo: {
      value: pboResult.pbo,
      interpretation: pboInterpretation,
      performanceDegradation: pboResult.performanceDegradation,
    },
    warnings,
  };
}
