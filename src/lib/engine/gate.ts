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
  // Spec §59: action-memory / same-ticker reversal cost, decayed over edge horizon.
  // Stateless engine — caller supplies the pre-decayed bps (0 when no recent
  // opposite-side fill or memory disabled).
  actionMemoryBps?: number;
  // Spec §21: concentration penalty in bps subtracted from the raw model edge.
  // Caller (portfolio-aware layer) supplies this; universe-wide scan leaves 0.
  concentrationBps?: number;
}

export interface GateResult {
  modelEdge: number;
  cEntry: number;
  cExit: number;
  cQueue: number;
  cMemory: number;
  cConcentration: number;
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
      cMemory: 0,
      cConcentration: 0,
      required: 0,
      net: modelEdge,
      decision: "HOLD",
    };
  }

  const sa = Math.min(1000, g.spreadBps);

  const va = g.volPctPerBar != null ? 100 * g.volPctPerBar : 0;
  // Spec §59: ua = notional/barDollarVol; when volume is missing and notional>0
  // treat as full-size (ua=1) rather than free.
  const hasBarVol = g.barDollarVol > 0;
  const ua = hasBarVol ? g.notional / g.barDollarVol : (g.notional > 0 ? 1 : 0);
  const C_liq_natural = Math.min(120, 0.25 + 9 * Math.sqrt(Math.min(9, ua)));
  // Spec §59: missing-liquidity floor of 35 fires when barDollarVol==0 with positive notional.
  const C_liq = !hasBarVol && g.notional > 0 ? Math.max(35, C_liq_natural) : C_liq_natural;

  const C_stale = staleCost(g.quoteAgeSec);
  const C_gap = clamp((g.gapDays - 1) * 1.75, 0, 25);

  const C_side = (0.5 * sa + 0.10 * Math.min(200, va) + C_liq + C_stale) * g.sessionMult + C_gap;
  const cEntry = C_side;
  // Spec §59: BUY exit modeled at 0.65·C_side, then reserved at exit_reserve∈[0,1].
  const cExit  = 0.65 * C_side * clamp(g.exitReserve, 0, 1);
  const cQueue = Math.min(60, 0.8 + 12 * ua + 4.5 * Math.max(0, g.sessionMult - 1));
  const cMemory = Math.max(0, g.actionMemoryBps ?? 0);
  const cConcentration = Math.max(0, g.concentrationBps ?? 0);

  const required = Math.max(g.minHurdle, cEntry + cExit + cQueue + cMemory + g.opRisk);
  const net = modelEdge - cConcentration - g.cashWait - required;

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

  return { modelEdge, cEntry, cExit, cQueue, cMemory, cConcentration, required, net, decision };
}
