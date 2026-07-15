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
  // Hard per-name cap. Above this, weight is clipped and overflow water-fills
  // into uncapped names. MacLean/Thorp/Ziemba (2011) practitioner Kelly ceiling
  // is 3-5% NAV; 10% is 2× that — bounds tail risk without over-constraining.
  maxNameWeight: number;
}

// C2-1: cashFloor is env-configurable. Legacy 0.02; Michaud (1989) and
// DeMiguel/Garlappi/Uppal (2009) argue for larger cash buffer under
// parameter uncertainty. Default preserves 0.02; operators can raise to
// 0.05 baseline or 0.10 under regime uncertainty.
const CASH_FLOOR_DEFAULT = Number(process.env.PORTFOLIO_CASH_FLOOR ?? "0.02");

// C2-2: concentrationScale is env-configurable. Legacy 300 bps per unit
// squared overweight — the shadow price of the concentration constraint
// (Grinold & Kahn 2000 ch. 15). Recalibration against realized hit rate
// on shadow_resolved over-softcap rows is a future TCA-driven task.
const CONCENTRATION_SCALE_DEFAULT = Number(process.env.PORTFOLIO_CONCENTRATION_SCALE ?? "300");

const DEFAULT_OPTS: PortfolioBuildOpts = {
  cashFloor: CASH_FLOOR_DEFAULT,
  comfortableWeight: 0.35,
  concentrationScale: CONCENTRATION_SCALE_DEFAULT,
  gamma: 1.0,
  maxNameWeight: 0.10,
};

// Water-filling projection: clip any weight above cap, redistribute overflow
// proportionally into uncapped names. Iterates until stable (usually ≤ 3 passes
// even in adversarial slates; hard-bounded at 10 to fail loud on unexpected input).
function projectToMaxWeight(weights: number[], cap: number): number[] {
  if (cap <= 0 || !Number.isFinite(cap)) return weights.slice();
  const w = weights.slice();
  const isCapped = new Array(w.length).fill(false);
  for (let iter = 0; iter < 10; iter++) {
    let overflow = 0;
    for (let i = 0; i < w.length; i++) {
      if (!isCapped[i] && w[i] > cap) {
        overflow += w[i] - cap;
        w[i] = cap;
        isCapped[i] = true;
      }
    }
    if (overflow === 0) break;
    let openMass = 0;
    for (let i = 0; i < w.length; i++) if (!isCapped[i]) openMass += w[i];
    if (openMass === 0) break; // all capped — residual returns to cash upstream
    for (let i = 0; i < w.length; i++) {
      if (!isCapped[i]) w[i] += overflow * (w[i] / openMass);
    }
  }
  return w;
}

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

  // Preliminary weights (pre-cap).
  const prelim = qualifying.map((c, i) => ({
    symbol: c.symbol,
    role: c.role,
    weight: grossExposure * (rawScores[i] / totalRaw),
  }));

  // Hard-cap projection: clip any single name above maxNameWeight, redistribute
  // overflow into uncapped names. Excess mass that cannot be redistributed
  // (e.g. all names capped) flows to cash via the cashWeight residual below.
  const cappedWeights = projectToMaxWeight(
    prelim.map((p) => p.weight),
    o.maxNameWeight,
  );

  // Concentration penalty per candidate: (w - w_comfort)^2 · scale, bps.
  // The scanner attaches this to the row so the gate charges it on re-scoring.
  const weights: TargetWeight[] = prelim.map((p, i) => {
    const w = cappedWeights[i];
    const over = Math.max(0, w - o.comfortableWeight);
    const conc = o.concentrationScale * over * over;
    return {
      symbol: p.symbol,
      role: p.role,
      targetWeight: w,
      concentrationBps: conc,
    };
  });

  const allocated = weights.reduce((a, w) => a + w.targetWeight, 0);
  const cashWeight = Math.max(0, 1 - allocated);
  return { weights, cashWeight };
}
