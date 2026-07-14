// Beta-shrinkage promotion posterior. Ported from shadow_monitor.py:posterior().
// Pure function — no state, no I/O.

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

export function computePosterior(
  rows: ReadonlyArray<{ delta_bps: number }>,
  opts: PosteriorOpts = {},
): Posterior {
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

  // n_eff placeholder: independent-sample assumption. Label-overlap correction
  // (n_eff = n / (1 + 2·ρ_label)) arrives in the P1 pass.
  const nEff = n;

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
