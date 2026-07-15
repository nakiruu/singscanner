// Beta-shrinkage promotion posterior. Ported from shadow_monitor.py:posterior().
// Pure function — no state, no I/O.
//
// Two-tier promotion gating:
//   Tier 1 (this module): raw posterior clears minCleanRows + minPositiveShare
//                         + minPosteriorDelta. Fast, cheap, per-horizon
//                         configurable via SHADOW_MIN_CLEAN_ROWS_{3D,5D,10D}.
//   Tier 2 (promotion-guard.ts): DSR floor + k-cycle peeking correction
//                         against Tier 1's Posterior. Set SHADOW_DSR_GATE=1
//                         to activate; consumes delta_post_se_bps from here.
// Do NOT raise SHADOW_MIN_POSTERIOR_DELTA_BPS globally when Tier 2 is on —
// the DSR floor already provides search-corrected significance.

export interface PosteriorOpts {
  kappa0?: number;               // default 7
  delta0?: number;               // default 0
  minCleanRows?: number;         // default 30
  minPositiveShare?: number;     // default 0.55
  minPosteriorDelta?: number;    // default 0
}

export interface Posterior {
  n_clean: number;
  positive_share: number;
  mean_delta_bps: number;
  delta_post_bps: number;
  // Bayesian posterior SE in bps. Consumers apply DSR/peeking corrections
  // against this, not against a bare point estimate.
  delta_post_se_bps: number;
  // Effective sample size. Equals n_clean here; P1 label-overlap correction
  // (n_eff = n_clean / (1 + 2·ρ_label)) will land in this slot.
  n_eff: number;
  promotable: boolean;
  reason: string;
}

function envNum(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

const DEFAULT_OPTS: Required<PosteriorOpts> = {
  kappa0:           envNum("SHADOW_KAPPA0",                  7),
  delta0:           envNum("SHADOW_DELTA0",                  0),
  minCleanRows:     envNum("SHADOW_MIN_CLEAN_ROWS",          30),
  minPositiveShare: envNum("SHADOW_MIN_POSITIVE_SHARE",      0.55),
  minPosteriorDelta: envNum("SHADOW_MIN_POSTERIOR_DELTA_BPS", 0),
};

// Per-horizon minCleanRows overrides. Label-overlap correction (B2-S3) shows
// n_eff at 10d ≈ n_clean/2, so longer horizons need proportionally more
// clean rows to reach the same effective evidence (Grinold & Kahn 2000 ch. 5).
// Falls back to SHADOW_MIN_CLEAN_ROWS when the horizon-specific env is unset.
function minCleanRowsForHorizon(horizon: string | undefined, base: number): number {
  if (horizon === "3d") return envNum("SHADOW_MIN_CLEAN_ROWS_3D", base);
  if (horizon === "5d") return envNum("SHADOW_MIN_CLEAN_ROWS_5D", base);
  if (horizon === "10d") return envNum("SHADOW_MIN_CLEAN_ROWS_10D", base);
  return base;
}

// Label-overlap coefficients per horizon (Grinold & Kahn 2000 ch. 5).
// Forward-return windows overlap between consecutive scans; the effective
// number of independent observations is n / (1 + 2·ρ). Values are practitioner
// defaults; refine against realized `shadow_resolved` correlations once
// the corpus is large enough.
const RHO_LABEL_BY_HORIZON: Record<string, number> = {
  "3d": 0.3,
  "5d": 0.4,
  "10d": 0.5,
};

export function computePosterior(
  rows: ReadonlyArray<{ delta_bps: number }>,
  opts: PosteriorOpts = {},
  horizon?: "3d" | "5d" | "10d",
): Posterior {
  // Resolve per-horizon minCleanRows override before merging opts.
  const baseMinCleanRows = opts.minCleanRows ?? DEFAULT_OPTS.minCleanRows;
  opts = { ...opts, minCleanRows: minCleanRowsForHorizon(horizon, baseMinCleanRows) };
  const o = { ...DEFAULT_OPTS, ...opts };
  const n = rows.length;
  if (n === 0) {
    return {
      n_clean: 0,
      positive_share: 0,
      mean_delta_bps: 0,
      delta_post_bps: o.delta0,
      delta_post_se_bps: 0,
      n_eff: 0,
      promotable: false,
      reason: "no clean resolved rows",
    };
  }
  const deltas = rows.map((r) => r.delta_bps);
  const meanD = deltas.reduce((a, b) => a + b, 0) / n;
  const posShare = deltas.filter((d) => d > 0).length / n;
  const deltaPost = (o.kappa0 * o.delta0 + n * meanD) / (o.kappa0 + n);

  // Normal-Normal conjugate posterior SE: σ̂² / (κ₀ + n).
  // sampleVar guard: n < 2 yields 0 SE (single observation carries no dispersion info).
  const sampleVar = n > 1
    ? deltas.reduce((s, d) => s + (d - meanD) * (d - meanD), 0) / (n - 1)
    : 0;
  const postVar = sampleVar / (o.kappa0 + n);
  const deltaSe = Math.sqrt(Math.max(0, postVar));

  // Effective sample size under label overlap. Independent-sample assumption
  // in the conjugate posterior is violated when forward-return windows overlap.
  // Downstream DSR + promotion-guard consume this to avoid over-confidence on
  // longer horizons.
  const rhoLabel = horizon != null ? (RHO_LABEL_BY_HORIZON[horizon] ?? 0) : 0;
  const nEff = rhoLabel > 0 ? n / (1 + 2 * rhoLabel) : n;

  const promotable =
    n >= o.minCleanRows && posShare >= o.minPositiveShare && deltaPost > o.minPosteriorDelta;
  const reason = promotable
    ? "promotion-ready"
    : `n=${n}/${o.minCleanRows}, pos_share=${posShare.toFixed(2)}/${o.minPositiveShare}, δ_post=${deltaPost.toFixed(1)}/${o.minPosteriorDelta.toFixed(1)}`;
  return {
    n_clean: n,
    positive_share: Math.round(posShare * 1000) / 1000,
    mean_delta_bps: Math.round(meanD * 100) / 100,
    delta_post_bps: Math.round(deltaPost * 100) / 100,
    delta_post_se_bps: Math.round(deltaSe * 100) / 100,
    n_eff: nEff,
    promotable,
    reason,
  };
}
