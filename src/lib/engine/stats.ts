// Pure math primitives used across the engine.
// Source: docs/instructions2.md

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function lerp(t: number, a: number, b: number): number {
  return a + (b - a) * t;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

// Linear ramp: 1 at or below threshold, drops by 1/ramp per unit above, clamped to [floor, 1].
export function ramp(value: number, thresh: number, rampWidth: number, floor: number): number {
  if (value <= thresh) return 1;
  return clamp(1 - (value - thresh) / rampWidth, floor, 1);
}

// percentileRank(value, sortedVals): binary-search percentile via average of bisectLeft+bisectRight.
// Returns 50 when n <= 1.
export function percentileRank(value: number, sortedVals: number[]): number {
  const n = sortedVals.length;
  if (n <= 1) return 50;
  const lo = bisectLeft(sortedVals, value);
  const hi = bisectRight(sortedVals, value);
  const eq = hi - lo;
  return (100 * (lo + 0.5 * eq)) / n;
}

export function bisectLeft(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function bisectRight(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
