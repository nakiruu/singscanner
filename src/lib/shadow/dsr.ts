// Deflated Sharpe Ratio (DSR).
//
// The naive promotion threshold `SHADOW_MIN_POSTERIOR_DELTA_BPS=0` is a
// single-trial test. When the pipeline picks the best of N candidate
// hyperparameter configurations, the expected max Sharpe from N pure-noise
// trials is ≈ √(2·log N) — meaning "significant" gets easier with more search.
//
// The Deflated Sharpe Ratio corrects for this by subtracting the null-mean
// max-Sharpe from the observed Sharpe and normalizing by the null-std.
// Empirically, DSR-adjusted p-values run 5-30× larger than naive p-values
// (Harvey, Liu & Zhu 2016, Review of Financial Studies).
//
// Bailey, D. H. & López de Prado, M. (2014). "The Deflated Sharpe Ratio:
// Correcting for Selection Bias, Backtest Overfitting, and Non-Normality."
// Journal of Portfolio Management 40(5).
//
// Pure functions — no I/O, no side effects.

const EULER = Math.E;
const EULER_MASCHERONI = 0.5772156649015329;

// Standard-normal inverse CDF via Beasley-Springer-Moro approximation.
// Accurate to ~1e-9 across the domain; adequate for DSR use where inputs
// are always in (0, 1) and rarely near the tails.
export function normalInverse(p: number): number {
  if (p <= 0 || p >= 1) return p <= 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  const a = [
    -3.969683028665376e+01,  2.209460984245205e+02, -2.759285104469687e+02,
     1.383577518672690e+02, -3.066479806614716e+01,  2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01,  1.615858368580409e+02, -1.556989798598866e+02,
     6.680131188771972e+01, -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00,  4.374664141464968e+00,  2.938163982698783e+00,
  ];
  const d = [
    7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
          ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// Expected maximum of N i.i.d. standard normals (approximation from
// Bailey & López de Prado 2014, eq. 6):
//   E[max_null] ≈ (1 − γ) · Φ⁻¹(1 − 1/N)  +  γ · Φ⁻¹(1 − 1/(N·e))
// where γ is Euler-Mascheroni. Exact enough for N in [2, 1e6].
export function expectedMaxSharpeNull(nTrials: number): number {
  if (nTrials <= 1) return 0;
  const term1 = (1 - EULER_MASCHERONI) * normalInverse(1 - 1 / nTrials);
  const term2 = EULER_MASCHERONI * normalInverse(1 - 1 / (nTrials * EULER));
  return term1 + term2;
}

// Standard deviation of the max of N i.i.d. standard normals, per
// Bailey/López de Prado eq. 7. Approaches √(2·log N) - E[max_null] for large N.
export function stdMaxSharpeNull(nTrials: number): number {
  if (nTrials <= 1) return 1;
  const emax = expectedMaxSharpeNull(nTrials);
  const rhs = normalInverse(1 - 1 / (nTrials * EULER));
  return Math.max(0, rhs - emax);
}

// Deflated Sharpe Ratio: converts an observed Sharpe into a "z-score under
// the max-null" — how many null-std deviations above the null-max mean does
// the observed live?
//
// observedSharpe : the pipeline's Sharpe estimate (e.g. δ_post / SE(δ_post))
// nTrials        : how many candidate configs were sampled to arrive at the winner
//
// Returns the DSR; DSR > 0 means the observed beats the expected null-max mean.
// Traditional interpretation: DSR > 2 corresponds to ~2σ significance.
export function deflatedSharpeRatio(observedSharpe: number, nTrials: number): number {
  if (nTrials <= 1) return observedSharpe;
  const emax = expectedMaxSharpeNull(nTrials);
  const smax = stdMaxSharpeNull(nTrials);
  if (smax <= 0) return observedSharpe - emax;
  return (observedSharpe - emax) / smax;
}

// DSR-aware promotion floor: the minimum posterior mean (in bps) that
// clears a nominal α-level test under a search of N trials.
//
// Uses the shadow monitor's posterior SE (from computePosterior in
// posterior.ts, P0 #1) as the Sharpe denominator: Sharpe ≈ δ_post / SE.
//
// alpha default 0.05; upstream can pass 0.01 for stricter promotion.
export function dsrPromotionFloor(
  posteriorSeBps: number,
  nTrials: number,
  alpha = 0.05,
): number {
  if (posteriorSeBps <= 0) return 0;
  // Threshold DSR corresponds to Φ⁻¹(1 − α); e.g. α=0.05 → z ≈ 1.645.
  const zAlpha = normalInverse(1 - alpha);
  const emax = expectedMaxSharpeNull(nTrials);
  const smax = stdMaxSharpeNull(nTrials);
  // Solve for observedSharpe such that (observedSharpe - emax) / smax = zAlpha.
  const requiredSharpe = emax + zAlpha * (smax > 0 ? smax : 1);
  return requiredSharpe * posteriorSeBps;
}
