// Purged rolling-origin cross-validation for overlapping-horizon time series.
//
// Random K-fold on `shadow_resolved` inflates apparent skill because forward-
// return windows overlap between train and test — a config that "learns" the
// training set can also see part of the test-set target through overlapping
// windows. López de Prado (2018, Advances in Financial Machine Learning,
// ch. 7) — "purging" removes any training sample whose forward-return window
// intersects a test window, and "embargoing" adds a further gap after each
// test window to prevent leakage through autocorrelation.
//
// This module ships fold generation + a generic score orchestrator. Offline
// hyperparameter sweeps against `shadow_resolved` (RIDGE_LAMBDA ×
// PRIOR_STRENGTH_KAPPA × DECAY_FACTOR × MAX_SAMPLES_PER_BUCKET grids) are
// exactly the workload that WILL overfit without this. Pure module — no CH,
// no I/O; the caller supplies both the data window and the score function.

export interface CVFold {
  trainStart: string;   // ISO date
  trainEnd: string;
  testStart: string;
  testEnd: string;
  embargoDays: number;
}

export interface CVConfig {
  windowStart: string;    // ISO date (inclusive)
  windowEnd: string;      // ISO date (inclusive)
  nFolds: number;         // typical: 5
  embargoDays: number;    // ≥ largest horizon in the ladder (10 for 3d/5d/10d)
  minTrainDays?: number;  // fold rejected if train window is shorter
}

export interface CVResult<TScore> {
  perFoldScores: TScore[];
  meanScore: TScore;      // caller-defined aggregation via scoreCombiner
}

export type ScoreFn<TConfig, TScore> = (
  config: TConfig,
  fold: CVFold,
) => Promise<TScore>;

export type ScoreCombiner<TScore> = (scores: TScore[]) => TScore;

// Rolling-origin fold generation. Test windows walk forward across the
// [windowStart, windowEnd] window; train windows extend from windowStart
// up to the fold's train-end, EXCLUDING any embargo period abutting the
// test window.
//
// Purging is implicit in the train/test date bounds — the caller is
// responsible for using the fold's train/test date ranges to filter their
// dataset. Rolling-origin (rather than expanding) is chosen because it
// gives comparable train-set sizes across folds; some analysts prefer
// expanding — swap by shortening trainStart to a fixed lookback.
export function makePurgedFolds(cfg: CVConfig): CVFold[] {
  const windowStartMs = parseIsoDay(cfg.windowStart);
  const windowEndMs = parseIsoDay(cfg.windowEnd);
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs)) {
    throw new Error(`purged-cv: bad window ${cfg.windowStart}..${cfg.windowEnd}`);
  }
  if (windowEndMs <= windowStartMs) {
    throw new Error("purged-cv: windowEnd must be after windowStart");
  }
  if (cfg.nFolds < 2) {
    throw new Error("purged-cv: nFolds must be >= 2");
  }
  if (cfg.embargoDays < 0) {
    throw new Error("purged-cv: embargoDays must be >= 0");
  }

  const totalDays = daysBetween(windowStartMs, windowEndMs);
  const testDaysPerFold = Math.floor(totalDays / (cfg.nFolds + 1));
  if (testDaysPerFold < 1) {
    throw new Error(
      `purged-cv: window too short for ${cfg.nFolds} folds (totalDays=${totalDays})`,
    );
  }
  const minTrainDays = cfg.minTrainDays ?? testDaysPerFold * 2;

  const folds: CVFold[] = [];
  for (let k = 0; k < cfg.nFolds; k++) {
    // Test window: [testStart, testEnd) walking forward from windowStart +
    // (k+1) * testDaysPerFold. Each fold's train ends `embargoDays` before
    // its test starts.
    const testStartOffset = (k + 1) * testDaysPerFold;
    const testStartMs = windowStartMs + testStartOffset * MS_PER_DAY;
    const testEndMs = testStartMs + testDaysPerFold * MS_PER_DAY;
    if (testEndMs > windowEndMs) break;
    const trainEndMs = testStartMs - cfg.embargoDays * MS_PER_DAY;
    if (trainEndMs - windowStartMs < minTrainDays * MS_PER_DAY) continue;
    folds.push({
      trainStart: cfg.windowStart,
      trainEnd: isoDayFromMs(trainEndMs),
      testStart: isoDayFromMs(testStartMs),
      testEnd: isoDayFromMs(testEndMs),
      embargoDays: cfg.embargoDays,
    });
  }
  return folds;
}

// Generic multi-config runner. Scores each config on each fold and returns
// results keyed by config. Serial execution — swap in Promise.all at the
// caller if the score fn is genuinely parallel-safe.
export async function runPurgedRollingOriginCV<TConfig, TScore>(
  cfg: CVConfig,
  configs: readonly TConfig[],
  scoreFn: ScoreFn<TConfig, TScore>,
  combineScores: ScoreCombiner<TScore>,
): Promise<Map<TConfig, CVResult<TScore>>> {
  const folds = makePurgedFolds(cfg);
  const results = new Map<TConfig, CVResult<TScore>>();
  for (const config of configs) {
    const perFoldScores: TScore[] = [];
    for (const fold of folds) {
      perFoldScores.push(await scoreFn(config, fold));
    }
    results.set(config, {
      perFoldScores,
      meanScore: combineScores(perFoldScores),
    });
  }
  return results;
}

// -- Helpers -----------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseIsoDay(s: string): number {
  return new Date(s + "T00:00:00Z").getTime();
}

function isoDayFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysBetween(startMs: number, endMs: number): number {
  return Math.round((endMs - startMs) / MS_PER_DAY);
}
