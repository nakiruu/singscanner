// Rotation surface. Spec §30:
//   RotationEV(a -> b) = EV_hold_b - EV_hold_a - sell_cost_a - buy_cost_b
//                        - transition_risk - partial_fill_pairing_risk
//   rotate only if RotationEV > hurdle.
//
// The scanner scores each candidate independently; this module compares held
// positions against the top BUY slate and emits explicit RotationCandidate
// records that the per-user overlay can surface as ROTATE decisions.

import {
  buildRotationEvBreakdown,
  type RotationEvBreakdown,
} from "./rotation-breakdown";

export interface RotationHolding {
  symbol: string;
  role: string;              // "primary" | "secondary" | "retained" | "none"
  netBps: number;            // hold-side after-cost surplus (0 for underwater)
  modelEdgeBps: number;      // raw model edge for the current position
  exitCostBps: number;       // expected exit friction if we sold now
}

export interface RotationTarget {
  symbol: string;
  role: string;
  netBps: number;            // buy-side after-cost surplus
  entryCostBps: number;      // expected buy friction if we entered now
}

export interface RotationCandidate {
  fromSymbol: string;
  toSymbol: string;
  netAdvantageBps: number;   // RotationEV in bps
  hurdleBps: number;
  cleared: boolean;
}

export interface RotationOpts {
  // Extra hurdle over pure math delta — captures transition risk (spec §30).
  // Basis points.
  transitionHurdleBps: number;
  // Ignore rotations where the target has less than this net edge advantage.
  minAdvantageBps: number;
  // Only consider top-N targets per held name (keeps output bounded).
  topN: number;
}

const DEFAULT_ROTATION_OPTS: RotationOpts = {
  transitionHurdleBps: 25,
  minAdvantageBps: 15,
  topN: 3,
};

// Horizon-scaled hurdle presets. Alpha decays roughly √t at cross-sectional
// signals so 10d requires 2.4× the 3d hurdle to gate a rotation at equivalent
// significance (Grinold 2010; Qian/Sorensen/Hua 2007). Callers pass this
// into scoreRotations to per-horizon-scale the hurdle without stomping on
// the DEFAULT_ROTATION_OPTS behavior other consumers rely on. From
// P2-PLAN.md C2-4.
export function rotationOptsForHorizon(
  horizon: "3d" | "5d" | "10d" | "21d",
): Pick<RotationOpts, "transitionHurdleBps" | "minAdvantageBps"> {
  switch (horizon) {
    case "3d":  return { transitionHurdleBps: 25, minAdvantageBps: 15 };
    case "5d":  return { transitionHurdleBps: 35, minAdvantageBps: 20 };
    case "10d": return { transitionHurdleBps: 60, minAdvantageBps: 30 };
    case "21d": return { transitionHurdleBps: 90, minAdvantageBps: 45 };
  }
}

// Compute RotationEV(a -> b) in bps.
// Spec §30: (EV_hold_b - EV_hold_a) - (sell_cost_a + buy_cost_b + transition).
// Legacy scalar API preserved; use rotationEvBreakdown() for the decomposed
// record consumed by TCA panels and admin dashboards.
export function rotationEv(
  from: RotationHolding,
  to: RotationTarget,
): number {
  return rotationEvBreakdown(from, to).netAdvantageBps;
}

// Decomposed RotationEV. Currently populates edgeDelta + sellCost + buyCost
// from the RotationHolding/Target inputs; risk terms (transitionRisk,
// partialFillPenalty, holdingCostAsymmetry) default to 0 pending caller
// wiring per Spec §30. C4-1.
export function rotationEvBreakdown(
  from: RotationHolding,
  to: RotationTarget,
): RotationEvBreakdown {
  return buildRotationEvBreakdown({
    edgeDelta: to.netBps - from.netBps,
    sellCost: from.exitCostBps,
    buyCost: to.entryCostBps,
  });
}

// Build the rotation candidate set for one holding vs a slate of targets.
//
// Sort order: netAdvantageBps DESC, then toSymbol ASC as an explicit
// tie-breaker. Ties at the primary criterion (identical EV to two names)
// were previously broken by array iteration order — deterministic today but
// unstable across upstream reorderings. Alphabetical secondary sort is
// arbitrary but STABLE (Paleologo 2021).
export function scoreRotations(
  holding: RotationHolding,
  targets: readonly RotationTarget[],
  opts: Partial<RotationOpts> = {},
): RotationCandidate[] {
  const o = { ...DEFAULT_ROTATION_OPTS, ...opts };
  const scored: RotationCandidate[] = targets
    .filter((t) => t.symbol !== holding.symbol)
    .map((t) => {
      const ev = rotationEv(holding, t);
      const hurdle = o.transitionHurdleBps + o.minAdvantageBps;
      return {
        fromSymbol: holding.symbol,
        toSymbol: t.symbol,
        netAdvantageBps: ev,
        hurdleBps: hurdle,
        cleared: ev > hurdle,
      };
    })
    .sort((a, b) => {
      const primary = b.netAdvantageBps - a.netAdvantageBps;
      if (primary !== 0) return primary;
      return a.toSymbol.localeCompare(b.toSymbol);
    })
    .slice(0, Math.max(1, o.topN));
  return scored;
}
