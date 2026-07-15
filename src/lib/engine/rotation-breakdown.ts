// RotationEV breakdown types.
//
// Spec §30 defines RotationEV as a six-term decomposition:
//   RotationEV(a→b) = edgeDelta - sellCost_a - buyCost_b
//                   - transitionRisk - partialFillPenalty - holdingCostAsymmetry
//
// The legacy rotationEv() returns only the scalar aggregate. This module
// carries the per-term breakdown so admin dashboards and TCA panels can
// attribute rotation decisions to the underlying components — essential
// for calibrating transitionHurdleBps by observing which term dominates
// borderline rejections.

export interface RotationEvBreakdown {
  // Positive means `to` has more after-cost surplus than `from`.
  edgeDelta: number;
  // Cost side (all in bps, all subtracted from edgeDelta):
  sellCost: number;
  buyCost: number;
  // Uncertainty adjustments — set to 0 when caller doesn't decompose.
  transitionRisk: number;
  partialFillPenalty: number;
  holdingCostAsymmetry: number;
  // Aggregate advantage (edgeDelta - all costs). Matches the legacy scalar
  // returned by rotationEv() when the extra risk terms are 0.
  netAdvantageBps: number;
}

// Build a breakdown from the canonical fields. Missing risk terms default
// to 0 so the aggregate reduces to the legacy 2-term formula
// (edgeDelta - transactionCost) when the caller has nothing to say about
// transition risk / partial fill / holding asymmetry.
export function buildRotationEvBreakdown(inputs: {
  edgeDelta: number;
  sellCost: number;
  buyCost: number;
  transitionRisk?: number;
  partialFillPenalty?: number;
  holdingCostAsymmetry?: number;
}): RotationEvBreakdown {
  const transitionRisk = inputs.transitionRisk ?? 0;
  const partialFillPenalty = inputs.partialFillPenalty ?? 0;
  const holdingCostAsymmetry = inputs.holdingCostAsymmetry ?? 0;
  const netAdvantageBps =
    inputs.edgeDelta
    - inputs.sellCost
    - inputs.buyCost
    - transitionRisk
    - partialFillPenalty
    - holdingCostAsymmetry;
  return {
    edgeDelta: inputs.edgeDelta,
    sellCost: inputs.sellCost,
    buyCost: inputs.buyCost,
    transitionRisk,
    partialFillPenalty,
    holdingCostAsymmetry,
    netAdvantageBps,
  };
}
