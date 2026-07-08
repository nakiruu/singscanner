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
  promotable: boolean;
  reason: string;
}

const DEFAULT_OPTS: Required<PosteriorOpts> = {
  kappa0: 7,
  delta0: 0,
  minCleanRows: 30,
  minPositiveShare: 0.55,
  minPosteriorDelta: 0,
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
      promotable: false,
      reason: "no clean resolved rows",
    };
  }
  const deltas = rows.map((r) => r.delta_bps);
  const meanD = deltas.reduce((a, b) => a + b, 0) / n;
  const posShare = deltas.filter((d) => d > 0).length / n;
  const deltaPost = (o.kappa0 * o.delta0 + n * meanD) / (o.kappa0 + n);
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
    promotable,
    reason,
  };
}
