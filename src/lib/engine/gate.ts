// After-cost gate (BUY side, non-held).
// Source: docs/instructions2.md "After-cost gate (BUY side, non-held)".

import { clamp } from "./stats";
import type { Decision, Role } from "./types";

export interface GateInput {
  role: Role;
  roleEdge: number;          // bps for the role's band (primary/secondary/retained)
  friction: number;          // role-specific friction multiplier (will be clamped to [frictionFloor, frictionCeiling])
  frictionFloor: number;     // from Calibration
  frictionCeiling: number;   // from Calibration
  spreadBps: number;
  volPctPerBar: number | null;   // fractional, e.g. 0.012 = 1.2%/bar; null if unknown
  notional: number;          // intended trade notional in $
  barDollarVol: number;      // bar-level $ volume
  quoteAgeSec: number;
  gapDays: number;           // # of trading days since last bar (1 = normal)
  sessionMult: number;       // from Calibration (regular/extended/closed)
  exitReserve: number;       // from Calibration
  opRisk: number;            // from Calibration (bps)
  cashWait: number;          // from Calibration (bps)
  minHurdle: number;         // from Calibration (bps)
  isHeld: boolean;
  isMember: boolean;         // member of the long-side cohort (P_up>=memberPupMin & evidence>=thresh)
}

export interface GateResult {
  modelEdge: number;
  cEntry: number;
  cExit: number;
  cQueue: number;
  required: number;
  net: number;
  decision: Decision;
}

// Linear stale-quote cost per spec:
//   age <= 8s         -> 0
//   age <= 60s        -> (age-8)/6, capped at 20
//   age >  60s        -> 4 + (age-60)/10, capped at 80
function staleCost(ageSec: number): number {
  if (ageSec <= 8) return 0;
  if (ageSec <= 60) return Math.min(20, (ageSec - 8) / 6);
  return Math.min(80, 4 + (ageSec - 60) / 10);
}

export function gateDecision(g: GateInput): GateResult {
  // Python friction_mult() clamps the multiplier into [frictionFloor, frictionCeiling].
  const fmult = clamp(g.friction, g.frictionFloor, g.frictionCeiling);
  const modelEdge = g.roleEdge * fmult;

  // Held positions don't go through the BUY gate at all.
  if (g.isHeld) {
    return {
      modelEdge,
      cEntry: 0,
      cExit: 0,
      cQueue: 0,
      required: 0,
      net: modelEdge,
      decision: "HOLD",
    };
  }

  const sa = Math.min(1000, g.spreadBps);

  // volPctPerBar missing -> spec says "C_liq floor 35 if vol missing"
  // We compute C_liq normally if we have vol; otherwise use the 35 floor.
  const va = g.volPctPerBar != null ? 100 * g.volPctPerBar : 0;
  const ua = g.barDollarVol > 0 ? g.notional / g.barDollarVol : 9;
  const C_liq_natural = Math.min(120, 0.25 + 9 * Math.sqrt(Math.min(9, ua)));
  const C_liq = g.volPctPerBar == null ? Math.max(35, C_liq_natural) : C_liq_natural;

  const C_stale = staleCost(g.quoteAgeSec);
  // C_gap: gapDays of 1 (normal) contributes 0; each extra day adds 1.75bps, capped at 25.
  const C_gap = clamp((g.gapDays - 1) * 1.75, 0, 25);

  const C_side = (0.5 * sa + 0.10 * Math.min(200, va) + C_liq + C_stale) * g.sessionMult + C_gap;
  const cEntry = C_side;
  const cExit  = 0.65 * C_side * g.exitReserve;
  // C_queue: queueing risk grows with notional impact and away-from-regular sessions.
  const cQueue = Math.min(60, 0.8 + 12 * ua + 4.5 * Math.max(0, g.sessionMult - 1));

  const required = Math.max(g.minHurdle, cEntry + cExit + cQueue + g.opRisk);
  const net = modelEdge - g.cashWait - required;

  let decision: Decision;
  if (g.role === "none") {
    decision = "HOLD-CASH";
  } else if (net > 0) {
    decision = "BUY";
  } else if (g.isMember) {
    // Member but the economics don't clear: park as WAIT.
    decision = "WAIT";
  } else {
    decision = "HOLD-CASH";
  }

  return { modelEdge, cEntry, cExit, cQueue, required, net, decision };
}
