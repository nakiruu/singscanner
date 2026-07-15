// Probability of Backtest Overfitting (PBO).
//
// Bailey, Borwein, López de Prado & Zhu (2017). "The probability of backtest
// overfitting." Journal of Computational Finance 20(4).
//
// Given N candidate configurations scored across M time slices, PBO answers:
// "if I pick the config that looked best in-sample, what is the probability
// that it will underperform the median config out-of-sample?"
//
// Procedure. Partition the M slices combinatorially into (S_in, S_out) pairs
// of equal size (M must be even). For each pair:
//   1. best_in = argmax over configs of mean(score[c, S_in])
//   2. R_out   = median across configs of the out-of-sample mean score
//   3. indicator = 1 if score[best_in, S_out] ≤ R_out else 0
// PBO = mean(indicator over all C(M, M/2) splits).
//
// Interpretation (Bailey et al. 2017):
//   PBO > 0.50  → the "winning" config is more likely to underperform
//                  the median out-of-sample than not. Invalidating.
//   PBO ≈ 0.30-0.50 → serious overfitting risk. Deflate expectations.
//   PBO < 0.30 → the winning config likely holds up out-of-sample.
//
// Bailey et al. report that average PBO across published equity strategies
// exceeds 0.50 — half of "significant" backtests are noise.
//
// Pure module — no I/O. Caller supplies the score matrix (M × N) where
// scoreMatrix[sliceIdx][configIdx] is the config's score on that slice.

export interface PBOInput {
  // scoreMatrix[m][c] = score of config c on slice m. Higher = better.
  // Rectangular; every slice must score every config.
  scoreMatrix: number[][];
  // Maximum number of combinatorial splits to enumerate. Full enumeration
  // is C(M, M/2) which grows explosively; 12,870 for M=16, 155,117,520 for
  // M=32. Cap enumeration at maxSplits by random sampling when the full
  // count would exceed it. Default 20_000.
  maxSplits?: number;
  // Optional seed for reproducible random subsampling. Default: time-based.
  seed?: number;
}

export interface PBOResult {
  pbo: number;              // ∈ [0, 1]
  nSplits: number;          // number of combinatorial splits actually evaluated
  nSlices: number;          // M
  nConfigs: number;         // N
  logits: number[];         // rank-logit series across splits — for calibration diagnostics
  performanceDegradation: number;  // OLS slope of in-sample rank vs out-of-sample rank
}

export function computePBO(input: PBOInput): PBOResult {
  const scoreMatrix = input.scoreMatrix;
  const M = scoreMatrix.length;
  const N = M === 0 ? 0 : scoreMatrix[0].length;
  const maxSplits = input.maxSplits ?? 20_000;

  if (M < 2 || N < 2) {
    return { pbo: 0, nSplits: 0, nSlices: M, nConfigs: N, logits: [], performanceDegradation: 0 };
  }
  if (M % 2 !== 0) {
    throw new Error(`computePBO: number of slices M=${M} must be even for combinatorial split`);
  }
  // Validate rectangular matrix.
  for (let m = 0; m < M; m++) {
    if (scoreMatrix[m].length !== N) {
      throw new Error(`computePBO: scoreMatrix row ${m} has length ${scoreMatrix[m].length}, expected ${N}`);
    }
  }

  const half = M / 2;
  const splits = enumerateSplits(M, half, maxSplits, input.seed);

  const logits: number[] = [];
  const inSampleRanks: number[] = [];
  const outSampleRanks: number[] = [];
  let overfitCount = 0;

  for (const sIn of splits) {
    const sOut = complement(sIn, M);
    const meansIn = meanPerConfig(scoreMatrix, sIn, N);
    const meansOut = meanPerConfig(scoreMatrix, sOut, N);

    // Best in-sample config → check its out-of-sample rank.
    const bestIn = argmax(meansIn);
    const rankOutOfBestIn = rankOf(meansOut, bestIn);   // 0-based rank ascending
    const percentileOut = rankOutOfBestIn / (N - 1);     // 0 = worst, 1 = best OOS

    const medianOut = median(meansOut);
    if (meansOut[bestIn] <= medianOut) overfitCount++;

    // rank-logit: log(pct / (1 - pct)); clamped away from 0/1 to keep finite.
    const pctClamped = Math.max(1e-6, Math.min(1 - 1e-6, percentileOut));
    logits.push(Math.log(pctClamped / (1 - pctClamped)));

    // Track in-sample vs out-of-sample rank for degradation regression.
    const rankInOfBestIn = rankOf(meansIn, bestIn);      // bestIn's IS rank = N-1 by construction
    inSampleRanks.push(rankInOfBestIn);
    outSampleRanks.push(rankOutOfBestIn);
  }

  const pbo = overfitCount / splits.length;
  const performanceDegradation = olsSlope(inSampleRanks, outSampleRanks);

  return {
    pbo: round4(pbo),
    nSplits: splits.length,
    nSlices: M,
    nConfigs: N,
    logits,
    performanceDegradation: round4(performanceDegradation),
  };
}

// -- Split enumeration -------------------------------------------------------

// Enumerate up to maxSplits half-subsets of {0..M-1}. When C(M, half) is
// small, returns all of them; otherwise samples without replacement via
// Fisher-Yates on the slice indices.
function enumerateSplits(M: number, half: number, maxSplits: number, seed?: number): number[][] {
  const total = binomial(M, half);
  if (total <= maxSplits) {
    return allCombinations(M, half);
  }
  const out: number[][] = [];
  const rand = mulberry32(seed ?? Date.now());
  const seen = new Set<string>();
  while (out.length < maxSplits) {
    const arr = fisherYatesSubset(M, half, rand);
    const key = arr.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(arr);
  }
  return out;
}

function allCombinations(M: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  function rec(start: number, need: number) {
    if (need === 0) { out.push(cur.slice()); return; }
    for (let i = start; i <= M - need; i++) {
      cur.push(i);
      rec(i + 1, need - 1);
      cur.pop();
    }
  }
  rec(0, k);
  return out;
}

function fisherYatesSubset(M: number, k: number, rand: () => number): number[] {
  const arr = new Array<number>(M);
  for (let i = 0; i < M; i++) arr[i] = i;
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (M - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, k).sort((a, b) => a - b);
}

function complement(subset: readonly number[], M: number): number[] {
  const inSubset = new Set(subset);
  const out: number[] = [];
  for (let i = 0; i < M; i++) if (!inSubset.has(i)) out.push(i);
  return out;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  const kk = Math.min(k, n - k);
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1);
    if (!Number.isFinite(result)) return Number.POSITIVE_INFINITY;
  }
  return result;
}

// -- Score helpers -----------------------------------------------------------

function meanPerConfig(matrix: number[][], slices: readonly number[], N: number): number[] {
  const out = new Array<number>(N).fill(0);
  for (const s of slices) {
    for (let c = 0; c < N; c++) out[c] += matrix[s][c];
  }
  const k = slices.length;
  for (let c = 0; c < N; c++) out[c] /= k;
  return out;
}

function argmax(arr: readonly number[]): number {
  let bestI = 0;
  let bestV = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > bestV) { bestI = i; bestV = arr[i]; }
  }
  return bestI;
}

function rankOf(arr: readonly number[], idx: number): number {
  // 0-based rank ascending; ties broken by index.
  const target = arr[idx];
  let rank = 0;
  for (let i = 0; i < arr.length; i++) {
    if (i === idx) continue;
    if (arr[i] < target || (arr[i] === target && i < idx)) rank++;
  }
  return rank;
}

function median(arr: readonly number[]): number {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function olsSlope(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den > 0 ? num / den : 0;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

// Small deterministic PRNG (Mulberry32) so PBO runs are reproducible with
// a fixed seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
