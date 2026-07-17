// Regime classification interface + neutral stub.
//
// Per P3-PLAN.md D1-2, ships the interface today so downstream D2/D3
// consumers (composite-fit, horizon-regime, frictionPrimary override)
// can type against a stable type. The classifier itself is intentionally
// left as a no-op returning neutralRegime() — activating it before the
// pipeline has ≥ 12 months of realized data spanning at least one full
// VIX cycle would fit spurious regime boundaries (RECOMMENDATIONS.md
// deferred section).
//
// When a real classifier lands, the shape of classifyRegime is expected
// to be threshold-based on SPY 30d vol, universe dispersion, and shadow-
// monitor drift (posterior SE from P0 #1, net-divergence rate from C6-2).

export type MarketRegime = "calm" | "normal" | "stressed";

export interface RegimeContext {
  // Coarse VIX-anchored classification.
  regime: MarketRegime;
  // Confidence in the classification, [0, 1]. Low confidence signals
  // regime-transition territory — consumers should soften their response.
  // 0 means "classifier not yet trained; treat as neutral."
  confidence: number;
  // Free-form debug reason for the classification (for admin observability).
  reason: string;
}

// Neutral default. Used by every caller until the classifier is trained.
// Consumers of RegimeContext MUST tolerate confidence === 0 as
// "no signal, apply legacy default behavior" — the D3 items reject this
// as active input by default.
export function neutralRegime(): RegimeContext {
  return {
    regime: "normal",
    confidence: 0,
    reason: "regime classifier not yet trained",
  };
}

// Classifier-input shape. Left minimal for the stub; real classifier
// consumes the same shape plus optional shadow-monitor drift signals.
export interface RegimeClassifierInputs {
  // SPY 30d realized volatility (fractional, annualized).
  spy30dVol?: number | null;
  // SPY 30d return (fractional).
  spy30dReturn?: number | null;
  // Cross-sectional dispersion of the qualifying cohort's modelEdge —
  // proxy for stress (rising dispersion = names diverging).
  universeDispersion?: number | null;
}

// Classifier stub. Returns neutralRegime() until wired.
//
// The wire-up is intentionally deferred to D3-1 (regime detection layer),
// which itself waits on ≥ 12 months of posterior data. Do not activate
// on partial data.
export function classifyRegime(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _inputs: RegimeClassifierInputs,
): RegimeContext {
  return neutralRegime();
}
