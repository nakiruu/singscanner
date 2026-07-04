// Target portfolio construction. Spec §57: source-conviction allocation over
// evidence-qualified candidates. No fixed count, no hard position cap. Cash
// is the residual when no candidate clears the after-cost hurdle.
//
// Also implements the §21 concentration penalty per candidate, expressed in
// bps (so the gate can subtract it from raw model edge).

import type { Role } from "./types";

export interface CandidateInput {
  symbol: string;
  role: Role;
  // Provenance edge in bps (raw source-membership signal, pre-friction).
  // Spec §58: primary=460, secondary=348, retained=200, none=0.
  roleEdgeBps: number;
  // Source-conviction: net after-cost surplus in bps. Only positive net
  // contributes to the target book (spec §57: positive prediction handling).
  netBps: number;
  // Confidence (0..1) — used to shrink weight of uncertain names.
  confidence: number;
  // Whether the row is currently held (retained flavor).
  isHeld: boolean;
}

export interface TargetWeight {
  symbol: string;
  role: Role;
  targetWeight: number; // fraction of investable book, [0,1]
  concentrationBps: number; // penalty in bps for exceeding comfortable weight
}

export interface PortfolioBuildResult {
  weights: TargetWeight[];
  cashWeight: number;
}

export interface PortfolioBuildOpts {
  // Spec §33: minimum cash floor as a fraction of book value.
  cashFloor: number;
  // Comfortable single-name weight; beyond this, concentration penalty kicks in.
  // Spec §21: concentration_cost = scale · sum_i max(w_i - w_comfort, 0)^2
  comfortableWeight: number;
  // Bps per unit of squared overweight — controls how aggressively we penalize.
  concentrationScale: number;
  // Spec §57 γ exponent: 1 keeps source-conviction linear.
  gamma: number;
}

const DEFAULT_OPTS: PortfolioBuildOpts = {
  cashFloor: 0.02,
  comfortableWeight: 0.35,
  concentrationScale: 300, // bps per unit squared overweight
  gamma: 1.0,
};

// Build target weights from a scored candidate slate.
//
// Rules (§57):
//   - Only rows with role ∈ {primary, secondary, retained} and netBps > 0 count.
//   - Raw weight ∝ (roleEdge · convictionBoost^γ · confidence).
//   - Gross exposure = 1 - cashFloor (long-only, cash-only budget).
//   - Weights normalized within qualifying set.
//   - Concentration penalty computed post-weighting.
export function buildTargetPortfolio(
  candidates: readonly CandidateInput[],
  opts: Partial<PortfolioBuildOpts> = {},
): PortfolioBuildResult {
  const o = { ...DEFAULT_OPTS, ...opts };
  const qualifying = candidates.filter(
    (c) => (c.role === "primary" || c.role === "secondary" || c.role === "retained") && c.netBps > 0,
  );

  if (qualifying.length === 0) {
    return { weights: [], cashWeight: 1 };
  }

  const grossExposure = Math.max(0, Math.min(1, 1 - o.cashFloor));

  // Raw scores: role prior × (netBps^γ) × confidence.
  // netBps is already after-cost, so it carries most of the ranking signal;
  // roleEdge is the Bayesian prior anchor from spec §58.
  const rawScores = qualifying.map((c) => {
    const conviction = Math.max(1, Math.pow(c.netBps, o.gamma));
    return Math.max(0, c.roleEdgeBps) * conviction * Math.max(0, Math.min(1, c.confidence));
  });
  const totalRaw = rawScores.reduce((a, b) => a + b, 0);
  if (totalRaw <= 0) {
    return { weights: [], cashWeight: 1 };
  }

  // Preliminary weights.
  const prelim = qualifying.map((c, i) => ({
    symbol: c.symbol,
    role: c.role,
    weight: grossExposure * (rawScores[i] / totalRaw),
  }));

  // Concentration penalty per candidate: (w - w_comfort)^2 · scale, bps.
  // The scanner attaches this to the row so the gate charges it on re-scoring.
  const weights: TargetWeight[] = prelim.map((p) => {
    const over = Math.max(0, p.weight - o.comfortableWeight);
    const conc = o.concentrationScale * over * over;
    return {
      symbol: p.symbol,
      role: p.role,
      targetWeight: p.weight,
      concentrationBps: conc,
    };
  });

  const allocated = weights.reduce((a, w) => a + w.targetWeight, 0);
  const cashWeight = Math.max(0, 1 - allocated);
  return { weights, cashWeight };
}
