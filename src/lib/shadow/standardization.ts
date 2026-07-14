// Per-bucket feature standardization for the dynamic challenger.
//
// Motivation. Ridge regression is not scale-invariant: `RIDGE_LAMBDA=5.0`
// penalizes each feature column by the same absolute amount, so a column
// with variance ~ 0.25 (role one-hot) sees weak regularization while a
// column with variance ~ 0.0025 (deltaWeight) is essentially crushed
// (Hoerl & Kennard 1970; Hastie/Tibshirani/Friedman 2009, ch. 3.4). The fix
// is to standardize each feature to comparable scale before it enters the
// ridge accumulator.
//
// Approach. Per-bucket running statistics — median (P²-quantile) plus MAD
// (streamed via a reservoir of the last N absolute-deviations). MAD is
// preferred over Welford variance because:
//   - Session/regime shifts create heavy tails; MAD is robust.
//   - `1.4826·MAD` is the consistent σ estimator under Gaussian noise.
//   - It composes cleanly with the P1 winsorization module (`winsorize.ts`).
//
// Wiring. Ships as a pure module with per-bucket state that dynamic-
// challenger.ts can attach behind SHADOW_FEATURE_STANDARDIZATION=1. The
// flag gates two things:
//   1. Update path: standardize features before accumulator write.
//   2. Predict path: apply the same standardization to the query vector.
//
// **Buckets built under the old scale must be rebuilt before enabling
// standardization globally.** See SHADOW_BUCKET_SCHEMA_VERSION migration
// notes in the shadow schema plan.

import { N_FEATURES } from "./features";

const RESERVOIR_SIZE = 200;   // per-feature history for MAD estimation
const MIN_SAMPLES = 20;       // below this, standardization is a no-op
const MIN_SCALE = 1e-6;       // guard against divide-by-zero on constant features

export interface FeatureStats {
  // Rolling reservoir of the last RESERVOIR_SIZE observations per feature.
  // Kept as a plain array-of-arrays to avoid ownership complexity across
  // bucket lifecycle.
  history: number[][];        // shape: [N_FEATURES][≤RESERVOIR_SIZE]
  n: number;                  // total observations seen (uncapped)
}

export function emptyFeatureStats(): FeatureStats {
  return {
    history: Array.from({ length: N_FEATURES }, () => []),
    n: 0,
  };
}

// Streaming update: append per-feature observation, evict oldest when full.
export function updateFeatureStats(stats: FeatureStats, features: readonly number[]): void {
  if (features.length !== N_FEATURES) return;
  for (let i = 0; i < N_FEATURES; i++) {
    const f = features[i];
    if (!Number.isFinite(f)) continue;
    const buf = stats.history[i];
    if (buf.length >= RESERVOIR_SIZE) buf.shift();
    buf.push(f);
  }
  stats.n += 1;
}

// z-score-like transform: (x - median) / (1.4826 * MAD). Returns the input
// unchanged when the reservoir has too few samples to estimate scale.
export function standardizeFeatures(
  features: readonly number[],
  stats: FeatureStats,
): number[] {
  if (features.length !== N_FEATURES) return features.slice();
  if (stats.n < MIN_SAMPLES) return features.slice();

  const out = new Array<number>(N_FEATURES);
  for (let i = 0; i < N_FEATURES; i++) {
    const buf = stats.history[i];
    if (buf.length < MIN_SAMPLES) {
      out[i] = features[i];
      continue;
    }
    const median = quantile(buf, 0.5);
    const mad = medianAbsoluteDeviation(buf, median);
    const scale = Math.max(MIN_SCALE, 1.4826 * mad);
    out[i] = (features[i] - median) / scale;
  }
  return out;
}

// -- Helpers -----------------------------------------------------------------

function quantile(values: readonly number[], q: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = q * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function medianAbsoluteDeviation(values: readonly number[], median: number): number {
  if (values.length === 0) return 0;
  const absDev = values.map((v) => Math.abs(v - median));
  return quantile(absDev, 0.5);
}
