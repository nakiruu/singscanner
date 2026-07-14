// Dynamic action-value surface challenger (§64).
// Port of singscannerauto3/dynamic_challenger.py.
//
// Per-bucket state: n, mean_y, mean_x[8], xtx[8][8], xty[8].
// Prediction: shrinkage toward fallback + within-bucket ridge adjustment.
// Update: incremental means + accumulator increments.

import {
  loadBuckets,
  upsertBucket,
  type BucketRow,
} from "./persistence";
import { N_FEATURES } from "./features";
import { clip } from "@/lib/engine/winsorize";
import {
  emptyFeatureStats,
  updateFeatureStats,
  standardizeFeatures,
  type FeatureStats,
} from "./standardization";

const PRIOR_STRENGTH_KAPPA = 20.0;
const RIDGE_LAMBDA = 5.0;
const MIN_SAMPLES_FOR_RIDGE = 8;
const MAX_SAMPLES_PER_BUCKET = 500;
const DECAY_FACTOR = 0.9;

// Debounce window: coalesce many updates into one flush per bucket.
const FLUSH_DEBOUNCE_MS = Number(process.env.SHADOW_BUCKET_FLUSH_DEBOUNCE_MS ?? "30000");

// Fixed-band winsorization on the update inputs. Wide enough to preserve
// genuine outcomes; narrow enough to prevent a single earnings-gap event
// from shifting ridge coefficients ~30% (López de Prado 2020, ch. 3). The
// per-bucket MAD-based variant will replace these once the standardization
// module maintains rolling stats. Behind SHADOW_WINSORIZE=1 to allow a
// clean A/B via the shadow monitor.
const WINSORIZE_ENABLED = process.env.SHADOW_WINSORIZE === "1";
const REALIZED_BPS_CAP = 1000; // ±10% single-observation cap
const FEATURE_MAGNITUDE_CAP = 5; // safe against exotic feature scales

// Feature standardization (per-bucket MAD z-scoring). Ridge is not scale-
// invariant, so this is the single largest fit-quality lift once wired
// (Hoerl & Kennard 1970; ESL ch. 3.4). MIGRATION HAZARD: enabling this on a
// running system with pre-existing buckets in `shadow_buckets` will
// mis-interpret the persisted xtx/xty (built on raw scale). Rebuild buckets
// before flipping the flag globally.
const STANDARDIZATION_ENABLED = process.env.SHADOW_FEATURE_STANDARDIZATION === "1";

export interface PredictDiag {
  bucket: string;
  n: number;
  shrinkage_strength: number;
  fallback_bps: number;
  bucket_mean: number | null;
  ridge_adj: number;
}

interface BucketState {
  bucket: string;
  n: number;
  meanY: number;
  meanX: number[]; // length 8
  xtx: number[];   // length 64, row-major 8×8
  xty: number[];   // length 8
  dirty: boolean;
  // Per-bucket rolling feature stats for MAD-based standardization. Populated
  // even when STANDARDIZATION_ENABLED is off so the reservoir warms in the
  // background; only READ from when the flag is on. Not persisted to CH
  // (rebuilt on process restart via warmup — bucket rebuild required for
  // full standardization semantics).
  stats: FeatureStats;
}

function emptyBucket(bucket: string): BucketState {
  return {
    bucket,
    n: 0,
    meanY: 0,
    meanX: new Array(N_FEATURES).fill(0),
    xtx: new Array(N_FEATURES * N_FEATURES).fill(0),
    xty: new Array(N_FEATURES).fill(0),
    dirty: false,
    stats: emptyFeatureStats(),
  };
}

function fromRow(row: BucketRow): BucketState {
  return {
    bucket: row.bucket,
    n: row.n,
    meanY: row.meanY,
    meanX: row.meanX.slice(),
    xtx: row.xtx.slice(),
    xty: row.xty.slice(),
    dirty: false,
    stats: emptyFeatureStats(),
  };
}

export class DynamicActionValueChallenger {
  private readonly horizon: string;
  private readonly buckets = new Map<string, BucketState>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(horizon: string) {
    this.horizon = horizon;
  }

  async load(): Promise<void> {
    const rows = await loadBuckets(this.horizon);
    for (const [key, row] of rows) {
      this.buckets.set(key, fromRow(row));
    }
  }

  // -- Prediction -----------------------------------------------------------

  predict(bucket: string, features: number[], fallbackBps: number): { estimate: number; diag: PredictDiag } {
    const b = this.buckets.get(bucket);
    if (!b || b.n < 3) {
      return {
        estimate: fallbackBps,
        diag: {
          bucket, n: b?.n ?? 0, shrinkage_strength: 0,
          fallback_bps: fallbackBps, bucket_mean: null, ridge_adj: 0,
        },
      };
    }
    // Standardization must be applied to the query vector iff the accumulator
    // was built on standardized inputs — both paths gated on the same flag.
    const x = STANDARDIZATION_ENABLED
      ? standardizeFeatures(features, b.stats)
      : features;
    let ridgeAdj = 0;
    if (b.n >= MIN_SAMPLES_FOR_RIDGE) {
      const beta = this.ridgeBeta(b);
      if (beta) {
        for (let i = 0; i < N_FEATURES; i++) {
          ridgeAdj += (x[i] - b.meanX[i]) * beta[i];
        }
      }
    }
    const w = b.n / (b.n + PRIOR_STRENGTH_KAPPA);
    let estimate = (1 - w) * fallbackBps + w * (b.meanY + ridgeAdj);
    estimate = Math.max(0, Math.min(600, estimate));
    return {
      estimate,
      diag: {
        bucket,
        n: b.n,
        shrinkage_strength: Math.round(w * 1000) / 1000,
        fallback_bps: Math.round(fallbackBps * 10) / 10,
        bucket_mean: Math.round(b.meanY * 10) / 10,
        ridge_adj: Math.round(ridgeAdj * 10) / 10,
      },
    };
  }

  // -- Update ---------------------------------------------------------------

  update(bucket: string, features: number[], realizedValueBps: number): void {
    if (features.length !== N_FEATURES) return;
    // Guard against NaN poisoning from CH string round-trips.
    if (!Number.isFinite(realizedValueBps) || features.some((f) => !Number.isFinite(f))) return;

    // Fixed-band winsorization to bound single-observation influence on the
    // ridge accumulator. Behind SHADOW_WINSORIZE=1 for staged rollout.
    let y = realizedValueBps;
    let x = features;
    if (WINSORIZE_ENABLED) {
      y = clip(y, -REALIZED_BPS_CAP, REALIZED_BPS_CAP);
      x = features.map((f) => clip(f, -FEATURE_MAGNITUDE_CAP, FEATURE_MAGNITUDE_CAP));
    }

    let b = this.buckets.get(bucket);
    if (!b) {
      b = emptyBucket(bucket);
      this.buckets.set(bucket, b);
    }
    // Warm the rolling feature stats even when standardization is off so the
    // reservoir is ready when the flag flips. Cheap: single array append.
    updateFeatureStats(b.stats, x);
    // Standardize update inputs iff enabled — matches predict-path treatment.
    if (STANDARDIZATION_ENABLED) {
      x = standardizeFeatures(x, b.stats);
    }
    if (b.n >= MAX_SAMPLES_PER_BUCKET) this.decay(b, DECAY_FACTOR);
    const nPrime = b.n + 1;
    b.meanY = (b.n * b.meanY + y) / nPrime;
    for (let i = 0; i < N_FEATURES; i++) {
      b.meanX[i] = (b.n * b.meanX[i] + x[i]) / nPrime;
      b.xty[i] += x[i] * y;
      for (let j = 0; j < N_FEATURES; j++) {
        b.xtx[i * N_FEATURES + j] += x[i] * x[j];
      }
    }
    b.n = nPrime;
    b.dirty = true;
    this.scheduleFlush();
  }

  private decay(b: BucketState, factor: number): void {
    b.n = Math.floor(b.n * factor);
    for (let i = 0; i < N_FEATURES; i++) {
      b.xty[i] *= factor;
      for (let j = 0; j < N_FEATURES; j++) {
        b.xtx[i * N_FEATURES + j] *= factor;
      }
    }
  }

  // -- Ridge solve (8×8 Gauss-Jordan) ---------------------------------------

  private ridgeBeta(b: BucketState): number[] | null {
    const A: number[][] = [];
    for (let i = 0; i < N_FEATURES; i++) {
      const row: number[] = [];
      for (let j = 0; j < N_FEATURES; j++) {
        row.push(b.xtx[i * N_FEATURES + j]);
      }
      row[i] += RIDGE_LAMBDA;
      A.push(row);
    }
    const bv = b.xty.slice();
    // Forward elimination
    for (let i = 0; i < N_FEATURES; i++) {
      const piv = A[i][i];
      if (Math.abs(piv) < 1e-9) return null;
      for (let j = i + 1; j < N_FEATURES; j++) {
        const factor = A[j][i] / piv;
        for (let k = i; k < N_FEATURES; k++) A[j][k] -= factor * A[i][k];
        bv[j] -= factor * bv[i];
      }
    }
    // Back substitution
    const beta = new Array(N_FEATURES).fill(0) as number[];
    for (let i = N_FEATURES - 1; i >= 0; i--) {
      let s = bv[i];
      for (let j = i + 1; j < N_FEATURES; j++) s -= A[i][j] * beta[j];
      beta[i] = s / A[i][i];
    }
    return beta;
  }

  // -- Flush ----------------------------------------------------------------

  scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, FLUSH_DEBOUNCE_MS);
  }

  async flushNow(): Promise<void> {
    const now = new Date().toISOString();
    for (const b of this.buckets.values()) {
      if (!b.dirty) continue;
      await upsertBucket({
        horizon: this.horizon,
        bucket: b.bucket,
        updatedAt: now,
        n: b.n,
        meanY: b.meanY,
        meanX: b.meanX,
        xtx: b.xtx,
        xty: b.xty,
      });
      b.dirty = false;
    }
  }

  // -- Introspection --------------------------------------------------------

  status(): Array<{ bucket: string; n: number; mean_y_bps: number }> {
    return Array.from(this.buckets.values())
      .map((b) => ({ bucket: b.bucket, n: b.n, mean_y_bps: Math.round(b.meanY * 100) / 100 }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));
  }
}
