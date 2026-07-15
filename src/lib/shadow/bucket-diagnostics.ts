// Bucket diagnostics — sign-stability, residual variance, and effective-n
// tracking per (horizon, bucket) tuple.
//
// The dynamic challenger fits ridge β per bucket and flushes to CH; without
// this module those betas are opaque. Two questions we can now answer:
//
//   1. Sign stability. Across the last N flushes, does each coefficient
//      have a consistent sign? A bucket with sign-flipping coefficients
//      is one the model has no consistent view of — either an under-
//      sampled bucket or a genuinely noisy market segment. Callers can
//      use signStability < 0.6 as a "don't trust this bucket's ridge
//      adjustment" signal.
//
//   2. Residual variance drift. Rising residual variance flush-over-flush
//      indicates the challenger is being fed data it can't model — either
//      a regime change or a bug upstream. Complements C6-1 SRM canary
//      (which detects sample-count anomalies) with a fit-quality signal.
//
// In-memory ring buffer per (horizon, bucket) — restart resets state.
// CH-backed history is a P3 follow-up if we need it.

import { N_FEATURES } from "./features";

const HISTORY_SIZE = 20;   // flushes retained per bucket
const MIN_HISTORY_FOR_STABILITY = 4;

interface BucketFlushRecord {
  ts: number;
  beta: number[];        // length N_FEATURES
  residualVar: number;
  nEff: number;
}

export interface BucketDiag {
  horizon: string;
  bucket: string;
  flushCount: number;
  latestNEff: number;
  latestResidualVar: number;
  // Sign-stability per feature: fraction of history where sign matches
  // the most-recent sign, in [0, 1]. Length N_FEATURES; 1.0 = perfectly
  // stable, 0.5 = coin-flip.
  signStability: number[];
  // Mean signStability across features — quick single-number health.
  meanSignStability: number;
  // Fit-quality drift: `latest / mean(prior)` residual-variance ratio.
  // > 1.5 signals rising fit error; < 0.7 signals regime the model now
  // captures. Undefined when history too short.
  residualVarDrift: number | null;
}

// Anchored on globalThis so instrumentation and route-handler bundles share
// the same buffer per (horizon, bucket) — same pattern as backlog progress.
const globalDiag = globalThis as unknown as {
  __shadowBucketDiagnostics?: Map<string, BucketFlushRecord[]>;
};
const historyByKey: Map<string, BucketFlushRecord[]> =
  (globalDiag.__shadowBucketDiagnostics ??= new Map());

function keyOf(horizon: string, bucket: string): string {
  return `${horizon}|${bucket}`;
}

// Called from dynamic-challenger.ts on flush. Cheap: single array append +
// evict, no allocations beyond the record itself.
export function recordBucketFlush(
  horizon: string,
  bucket: string,
  beta: readonly number[],
  residualVar: number,
  nEff: number,
): void {
  if (beta.length !== N_FEATURES) return;
  const key = keyOf(horizon, bucket);
  const buf = historyByKey.get(key) ?? [];
  buf.push({
    ts: Date.now(),
    beta: beta.slice(),
    residualVar,
    nEff,
  });
  if (buf.length > HISTORY_SIZE) buf.shift();
  historyByKey.set(key, buf);
}

// Read the diagnostic snapshot for one (horizon, bucket).
export function getBucketDiagnostic(horizon: string, bucket: string): BucketDiag | null {
  const buf = historyByKey.get(keyOf(horizon, bucket));
  if (!buf || buf.length === 0) return null;
  const latest = buf[buf.length - 1];

  // Sign-stability per feature: fraction where sign matches the latest.
  const signStability = new Array<number>(N_FEATURES).fill(1);
  if (buf.length >= MIN_HISTORY_FOR_STABILITY) {
    for (let i = 0; i < N_FEATURES; i++) {
      const latestSign = Math.sign(latest.beta[i]);
      if (latestSign === 0) {
        signStability[i] = 1; // zero is trivially "stable"
        continue;
      }
      let matches = 0;
      for (const r of buf) {
        if (Math.sign(r.beta[i]) === latestSign) matches++;
      }
      signStability[i] = matches / buf.length;
    }
  }
  const meanSignStability = signStability.reduce((s, x) => s + x, 0) / N_FEATURES;

  // Residual variance drift: latest / mean(prior).
  let residualVarDrift: number | null = null;
  if (buf.length >= MIN_HISTORY_FOR_STABILITY) {
    const prior = buf.slice(0, -1);
    const meanPrior = prior.reduce((s, r) => s + r.residualVar, 0) / prior.length;
    if (meanPrior > 1e-9) {
      residualVarDrift = latest.residualVar / meanPrior;
    }
  }

  return {
    horizon,
    bucket,
    flushCount: buf.length,
    latestNEff: latest.nEff,
    latestResidualVar: latest.residualVar,
    signStability,
    meanSignStability,
    residualVarDrift,
  };
}

// Return diagnostics for every known bucket in a horizon. Empty array when
// no flushes have been recorded yet.
export function getAllBucketDiagnostics(horizon: string): BucketDiag[] {
  const out: BucketDiag[] = [];
  const prefix = `${horizon}|`;
  for (const key of historyByKey.keys()) {
    if (!key.startsWith(prefix)) continue;
    const bucket = key.slice(prefix.length);
    const diag = getBucketDiagnostic(horizon, bucket);
    if (diag) out.push(diag);
  }
  return out.sort((a, b) => a.bucket.localeCompare(b.bucket));
}

// Test/debug helper — clears all in-memory diagnostics. Not exposed via any
// route; safe to call in test setup.
export function _resetBucketDiagnostics(): void {
  historyByKey.clear();
}
