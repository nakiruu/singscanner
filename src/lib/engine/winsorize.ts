// Shared clip utilities for robust statistics.
//
// Two complementary clipping strategies:
//
//   1. Percentile winsorization — canonical Green/Hand/Zhang (2017 RFS) step
//      in cross-sectional signal engineering. Cutoffs at 1%/99% for feature
//      distributions, 5%/95% for outcome distributions.
//
//   2. MAD-based clipping — outlier-robust scale via median absolute deviation
//      (López de Prado 2020, ch. 3). Preferred when the underlying distribution
//      is fat-tailed or the sample is small. `1.4826·MAD` is the consistent
//      estimator for σ under Gaussian noise.
//
// Both return {lo, hi} bounds; callers apply `clip(x, lo, hi)` to individual
// values. This split lets callers cache bounds across many samples.

export interface ClipBand {
  lo: number;
  hi: number;
}

export function clip(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return x;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

// -- Percentile winsorization -----------------------------------------------

export function percentileBand(
  values: readonly number[],
  loPct = 1,
  hiPct = 99,
): ClipBand {
  const n = values.length;
  if (n === 0) return { lo: 0, hi: 0 };
  if (n === 1) return { lo: values[0], hi: values[0] };

  const sorted = values.slice().sort((a, b) => a - b);
  const loIdx = Math.max(0, Math.min(n - 1, Math.floor((loPct / 100) * (n - 1))));
  const hiIdx = Math.max(0, Math.min(n - 1, Math.ceil((hiPct / 100) * (n - 1))));
  return { lo: sorted[loIdx], hi: sorted[hiIdx] };
}

// -- MAD-based clipping ------------------------------------------------------

export function madBand(values: readonly number[], k = 3): ClipBand {
  const n = values.length;
  if (n === 0) return { lo: 0, hi: 0 };
  if (n === 1) return { lo: values[0], hi: values[0] };

  const sorted = values.slice().sort((a, b) => a - b);
  const median = quantileSorted(sorted, 0.5);
  const absDev = sorted.map((v) => Math.abs(v - median));
  absDev.sort((a, b) => a - b);
  const mad = quantileSorted(absDev, 0.5);
  // 1.4826·MAD is the consistent σ estimator under Gaussian noise.
  const scale = 1.4826 * mad;
  return { lo: median - k * scale, hi: median + k * scale };
}

// -- Fixed absolute band (last-resort safety net) ----------------------------

export function absoluteBand(bound: number): ClipBand {
  return { lo: -Math.abs(bound), hi: Math.abs(bound) };
}

// -- Helpers -----------------------------------------------------------------

function quantileSorted(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const idx = q * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}
