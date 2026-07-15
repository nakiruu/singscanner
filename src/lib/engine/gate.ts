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
  // Session multipliers on each leg. Barclay & Hendershott (2003 RFS 16(4);
  // 2004 JoF 59(2)) show entry and exit have empirically different session
  // sensitivities; splitting the previous single sessionMult lets calibration
  // charge each leg on the session it will actually cross. When both mults
  // are set equal the outputs are byte-identical to the pre-split behavior.
  sessionMultEntry: number;  // from Calibration (regular/extended/closed)
  sessionMultExit: number;   // from Calibration
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

// -- Pure helpers ------------------------------------------------------------

// Inputs needed by both entry- and exit-leg cost computations. Extracted so
// callers (TCA panel, offline evaluators, tests) can drive either leg
// independently without owning a full GateInput.
export interface CostLegContext {
  spreadBps: number;
  volPctPerBar: number | null;
  notional: number;
  barDollarVol: number;
  quoteAgeSec: number;
  gapDays: number;
}

// Structured entry-leg output. Sub-components exposed so the TCA panel and
// admin dashboards can attribute cost residuals to spread / liquidity /
// stale-quote / gap without re-deriving them from cEntry alone.
export interface CEntryResult {
  cEntry: number;
  C_liq: number;
  C_stale: number;
  C_gap: number;
  ua: number;       // notional / barDollarVol — needed to compute cQueue
}

interface CostSubcomponents {
  sa: number;
  va: number;
  ua: number;
  C_liq: number;
  C_stale: number;
  C_gap: number;
  baseSideCost: number;  // 0.5·sa + 0.10·min(200,va) + C_liq + C_stale
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

// Shared base cost stack. Same for both legs; each leg then multiplies by
// its own session mult and adds C_gap.
function computeCostSubcomponents(ctx: CostLegContext): CostSubcomponents {
  const sa = Math.min(1000, ctx.spreadBps);
  const va = ctx.volPctPerBar != null ? 100 * ctx.volPctPerBar : 0;
  // Spec §59: ua = notional/barDollarVol; when volume is missing and notional>0
  // treat as full-size (ua=1) rather than free.
  const hasBarVol = ctx.barDollarVol > 0;
  const ua = hasBarVol ? ctx.notional / ctx.barDollarVol : (ctx.notional > 0 ? 1 : 0);
  const C_liq_natural = Math.min(120, 0.25 + 9 * Math.sqrt(Math.min(9, ua)));
  // Spec §59: missing-liquidity floor of 35 fires when barDollarVol==0 with positive notional.
  const C_liq = !hasBarVol && ctx.notional > 0 ? Math.max(35, C_liq_natural) : C_liq_natural;
  const C_stale = staleCost(ctx.quoteAgeSec);
  const C_gap = clamp((ctx.gapDays - 1) * 1.75, 0, 25);
  const baseSideCost = 0.5 * sa + 0.10 * Math.min(200, va) + C_liq + C_stale;
  return { sa, va, ua, C_liq, C_stale, C_gap, baseSideCost };
}

// Entry-leg cost: (spread + vol + liquidity + stale) × sessionMultEntry + C_gap.
// Returns the sub-components alongside cEntry so callers can inspect each
// contribution. Pure — no I/O, no clock reads.
export function computeCEntry(ctx: CostLegContext, sessionMultEntry: number): CEntryResult {
  const s = computeCostSubcomponents(ctx);
  return {
    cEntry: s.baseSideCost * sessionMultEntry + s.C_gap,
    C_liq: s.C_liq,
    C_stale: s.C_stale,
    C_gap: s.C_gap,
    ua: s.ua,
  };
}

// Exit-leg cost: 0.65 · (baseSideCost · sessionMultExit + C_gap) · exitReserve.
// The 0.65 haircut is Spec §59's BUY-exit convention (bundled half-spread +
// impact + adverse-selection). B5's cExit decomposition will replace this
// with an explicit Glosten-Milgrom formula behind a Calibration flag; keep
// the arithmetic identical here so B3 is a pure refactor.
export function computeCExit(
  ctx: CostLegContext,
  sessionMultExit: number,
  exitReserve: number,
): number {
  const s = computeCostSubcomponents(ctx);
  const C_side_exit = s.baseSideCost * sessionMultExit + s.C_gap;
  return 0.65 * C_side_exit * clamp(exitReserve, 0, 1);
}

// -- Main gate ---------------------------------------------------------------

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

  const ctx: CostLegContext = {
    spreadBps: g.spreadBps,
    volPctPerBar: g.volPctPerBar,
    notional: g.notional,
    barDollarVol: g.barDollarVol,
    quoteAgeSec: g.quoteAgeSec,
    gapDays: g.gapDays,
  };

  const entry = computeCEntry(ctx, g.sessionMultEntry);
  const cExit = computeCExit(ctx, g.sessionMultExit, g.exitReserve);
  // Queue cost is entry-leg (fills happen on entry). Session premium on queue
  // scales with how far above 1.0 the entry mult is.
  const cQueue = Math.min(60, 0.8 + 12 * entry.ua + 4.5 * Math.max(0, g.sessionMultEntry - 1));
  const cMemory = Math.max(0, g.actionMemoryBps ?? 0);
  const cConcentration = Math.max(0, g.concentrationBps ?? 0);

  const required = Math.max(g.minHurdle, entry.cEntry + cExit + cQueue + cMemory + g.opRisk);
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

  return {
    modelEdge,
    cEntry: entry.cEntry,
    cExit,
    cQueue,
    cMemory,
    cConcentration,
    required,
    net,
    decision,
  };
}
