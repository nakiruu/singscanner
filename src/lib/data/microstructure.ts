// Market microstructure estimators.
//
// Pure functions — no ClickHouse, no side effects. Consumers (gate cost model,
// TCA panel) call these with bar or spread inputs and receive bps-denominated
// estimates.
//
// Each function has a specific citation trail; do not swap implementations
// without checking the citation still applies.

// ─────────────────────────────────────────────────────────────────────────────
// Roll (1984) — implicit effective spread from serial covariance of price
// changes. The classical relation:  S = 2·√(-cov(ΔPₜ, ΔPₜ₋₁))
//
// Roll, R. (1984). "A Simple Implicit Measure of the Effective Bid-Ask Spread
// in an Efficient Market." Journal of Finance 39(4).
//
// When the estimated covariance is non-negative (positive serial correlation),
// Roll cannot recover a spread — returns 0 and lets the caller fall back to
// Corwin-Schultz.
// ─────────────────────────────────────────────────────────────────────────────

export function rollSpreadBps(closes: readonly number[]): number {
  if (closes.length < 3) return 0;
  const dP: number[] = [];
  for (let i = 1; i < closes.length; i++) dP.push(closes[i] - closes[i - 1]);
  if (dP.length < 2) return 0;

  const meanDp = dP.reduce((s, x) => s + x, 0) / dP.length;
  // Lag-1 sample covariance of ΔP.
  let cov = 0;
  for (let i = 1; i < dP.length; i++) {
    cov += (dP[i] - meanDp) * (dP[i - 1] - meanDp);
  }
  cov /= (dP.length - 1);

  if (cov >= 0) return 0;  // Roll cannot estimate a spread with pos autocov
  const spreadPx = 2 * Math.sqrt(-cov);
  const midPx = closes[closes.length - 1];
  if (midPx <= 0) return 0;
  return (spreadPx / midPx) * 10_000;
}

// ─────────────────────────────────────────────────────────────────────────────
// Corwin-Schultz (2012) — high-low estimator. Robust when Roll's covariance
// is noisy or non-negative. Uses two consecutive bar (H, L) pairs.
//
// Corwin, S. A. & Schultz, P. (2012). "A Simple Way to Estimate Bid-Ask
// Spreads from Daily High and Low Prices." Journal of Finance 67(2).
//
// Formula (single-day estimator averaged over the sample):
//   α = (√(2·β) - √β) / (3 - 2√2)  -  √(γ / (3 - 2√2))
//   S = 2·(e^α − 1) / (1 + e^α)
// where
//   β_t = [ln(H_t / L_t)]² + [ln(H_{t+1} / L_{t+1})]²
//   γ_t = [ln(max(H_t, H_{t+1}) / min(L_t, L_{t+1}))]²
//
// Negative α is set to 0 (Corwin-Schultz appendix).
// ─────────────────────────────────────────────────────────────────────────────

export interface HLBar {
  h: number;
  l: number;
}

export function corwinSchultzSpreadBps(bars: readonly HLBar[]): number {
  if (bars.length < 2) return 0;
  const alphas: number[] = [];
  for (let i = 0; i < bars.length - 1; i++) {
    const a = bars[i];
    const b = bars[i + 1];
    if (a.h <= 0 || a.l <= 0 || b.h <= 0 || b.l <= 0) continue;
    if (a.h < a.l || b.h < b.l) continue;

    const beta =
      Math.log(a.h / a.l) ** 2 +
      Math.log(b.h / b.l) ** 2;
    const hMax = Math.max(a.h, b.h);
    const lMin = Math.min(a.l, b.l);
    if (lMin <= 0) continue;
    const gamma = Math.log(hMax / lMin) ** 2;

    const denom = 3 - 2 * Math.SQRT2;
    const alpha = (Math.sqrt(2 * beta) - Math.sqrt(beta)) / denom - Math.sqrt(gamma / denom);
    alphas.push(Math.max(0, alpha));
  }
  if (alphas.length === 0) return 0;
  const meanAlpha = alphas.reduce((s, x) => s + x, 0) / alphas.length;
  const spread = (2 * (Math.exp(meanAlpha) - 1)) / (1 + Math.exp(meanAlpha));
  return spread * 10_000;
}

// ─────────────────────────────────────────────────────────────────────────────
// Amihud (2002) ILLIQ — daily illiquidity ratio.
//   ILLIQ = mean(|return_t| / dollarVolume_t)
//
// Amihud, Y. (2002). "Illiquidity and stock returns: cross-section and
// time-series effects." Journal of Financial Markets 5(1).
//
// Returned in units of 1 / $M (multiply by 1e6 to get bps-per-million).
// Callers translate to bps of round-trip cost per notional.
// ─────────────────────────────────────────────────────────────────────────────

export function amihudIlliq(
  returnsFrac: readonly number[],
  dollarVolumes: readonly number[],
): number {
  if (returnsFrac.length !== dollarVolumes.length || returnsFrac.length === 0) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < returnsFrac.length; i++) {
    const dv = dollarVolumes[i];
    if (dv <= 0) continue;
    sum += Math.abs(returnsFrac[i]) / dv;
    n++;
  }
  if (n === 0) return 0;
  return sum / n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Glosten-Milgrom (1985) — adverse-selection share of the spread. The half-
// spread has two components: order-processing (fixed) and adverse-selection
// (informational). The adverse-selection share rises when informed traders
// dominate the flow, which is empirically session-dependent per
// Barclay & Hendershott (2003, RFS 16(4); 2004, JoF 59(2)).
//
// Glosten, L. R. & Milgrom, P. R. (1985). "Bid, ask and transaction prices in
// a specialist market with heterogeneously informed traders." Journal of
// Financial Economics 14(1).
//
// Practitioner defaults from Kissell (2013, ch. 5): regular ≈ 35%,
// extended ≈ 55%, closed ≈ 90%.
// ─────────────────────────────────────────────────────────────────────────────

export type SessionBucket = "regular" | "premarket" | "afterhours" | "closed";

export const ADVERSE_SELECTION_SHARE: Record<SessionBucket, number> = {
  regular: 0.35,
  premarket: 0.55,
  afterhours: 0.55,
  closed: 0.90,
};

export function adverseSelectionBps(
  spreadBps: number,
  session: SessionBucket,
): number {
  if (spreadBps <= 0) return 0;
  const share = ADVERSE_SELECTION_SHARE[session] ?? ADVERSE_SELECTION_SHARE.regular;
  // Half-spread × adverse-selection share.
  return 0.5 * spreadBps * share;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: rolling effective spread that prefers Roll and falls back to
// Corwin-Schultz when Roll cannot recover a spread from positive autocov.
// Callers typically hold both close series (for Roll) and (H, L) bars (for
// CS), so we accept both and route.
// ─────────────────────────────────────────────────────────────────────────────

export interface RollingSpreadInputs {
  closes: readonly number[];    // for Roll
  bars: readonly HLBar[];       // for Corwin-Schultz fallback
}

export function rollingEffectiveSpreadBps(input: RollingSpreadInputs): number {
  const roll = rollSpreadBps(input.closes);
  if (roll > 0) return roll;
  return corwinSchultzSpreadBps(input.bars);
}
