// Horizon calibration. All "minutes" are trading minutes.
// Source: docs/instructions2.md "Horizon calibration"

import { clamp, lerp } from "./stats";

const MIN_HORIZON = 5;    // 5 minutes
const MAX_HORIZON = 8190; // 21 trading days * 6.5h * 60min

// Session-multiplier mode selector. Legacy (default) uses the original
// lerp envelope; "recal" raises to the Barclay-Hendershott (2003 RFS 16(4);
// 2004 JoF 59(2)) empirical envelope of 3-4× regular for extended sessions
// and multi-day carry for closed sessions. Env-controlled so operators can
// stage the raise against TCA panel evidence before flipping globally.
// See P1-REMAINING.md Batch B5 items V2/V3.
//
// Note: DO NOT enable simultaneously with GATE_SQRT_IMPACT_COEFF=25 —
// they multiply through C_side and paper-vs-live attribution becomes
// unattributable.
const SESSION_MULT_MODE = process.env.GATE_SESSION_MULT_MODE ?? "legacy";
const USE_RECAL_SESSION_MULTS = SESSION_MULT_MODE === "recal";

// C3-2: horizon-lerp primaryBand. Legacy fixed 30 bps under-represents
// long-horizon dispersion — 21d has wider raw-edge dispersion due to
// compounded vol (Grinold 2010). Enable via SIGNAL_PRIMARY_BAND_HORIZON_LERP=on.
const USE_PRIMARY_BAND_HORIZON_LERP =
  process.env.SIGNAL_PRIMARY_BAND_HORIZON_LERP === "on";

// C3-3: edgePrimary horizon-scale mode. Legacy uses fixed edgePrimary=460
// across horizons. IC(h) grows sub-linearly with √h (Grinold 2010;
// Qian/Sorensen/Hua 2007) — fixed absolute-bps band over-represents 21d,
// under-represents 3d. Modes:
//   "fixed" (default): current 460/348/200
//   "scaled":          edgePrimary(t) = base · √(hdEff/5)
const EDGE_BAND_MODE = process.env.SIGNAL_EDGE_BAND_MODE ?? "fixed";
const USE_EDGE_BAND_SCALED = EDGE_BAND_MODE === "scaled";

// C3-4: cashWait SPY-scaled. Multiplies the base cashWait lerp by the
// SPY 30d Sharpe proxy supplied via CalibrationContext. Bull tape →
// higher cashWait; bear tape → lower (Grinold & Kahn 2000 ch. 15
// reference-asset hurdle). Only fires when both the env flag is on AND
// the context is supplied.
const USE_CASH_WAIT_SPY_SCALED =
  process.env.SIGNAL_CASH_WAIT_SPY_SCALED === "on";

// C3-6: optional context supplied at calibrate-time to enable regime-
// conditional behavior. All fields optional; missing fields fall back to
// the static lerp defaults. Not yet consumed by anything on the default
// code path — unblocks P3 regime detection.
export interface CalibrationContext {
  // SPY 30d annualized return (fractional, e.g. 0.15 = +15%).
  spyReturn30d?: number;
  // SPY 30d realized volatility (fractional, annualized).
  spyVol30d?: number;
  // Universe cardinality at this snapshot (for adaptive-band scaling).
  universeSize?: number;
  // Cohort cardinality (rows passing evidence/pUp gate) — informs C3-1
  // adaptive primaryBand callers.
  cohortCardinality?: number;
  // Optional forward-declared market vol classification for future
  // regime-detection wiring.
  marketRegime?: "calm" | "normal" | "stressed";
}

// User-facing horizon presets exposed by the dashboard selector.
// 3d = shortest actionable swing window; 21d = one trading month.
// Anything outside this whitelist is refused by the API so the scanner's
// per-horizon cache can't grow unbounded from arbitrary query params.
export const HORIZON_PRESETS = ["3d", "5d", "10d", "21d"] as const;
export type HorizonPreset = typeof HORIZON_PRESETS[number];

export function isHorizonPreset(spec: string): spec is HorizonPreset {
  return (HORIZON_PRESETS as readonly string[]).includes(spec);
}

// Trading-minute values for each preset (used by the ladder + friction calc).
export const HORIZON_PRESET_MINUTES: Record<HorizonPreset, number> = {
  "3d":  3 * 6.5 * 60,
  "5d":  5 * 6.5 * 60,
  "10d": 10 * 6.5 * 60,
  "21d": 21 * 6.5 * 60,
};

// Parse spec like "5m", "1h", "3d" -> trading minutes.
// d = trading day = 390 minutes (6.5h). h = 60. m = 1.
export function parseHorizon(spec: string): number {
  const m = spec.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)([mhd])$/);
  if (!m) throw new Error(`bad horizon: ${spec}`);
  const n = parseFloat(m[1]);
  // Python parse_horizon floors result at 1 minute.
  switch (m[2]) {
    case "m": return Math.max(1, n);
    case "h": return Math.max(1, n * 60);
    case "d": return Math.max(1, n * 6.5 * 60);
  }
  throw new Error(`unreachable`);
}

// Log-scale interpolation factor between 5m and 21d anchors. Clamped to [0,1].
export function horizonT(horizonMin: number): number {
  const h = clamp(horizonMin, MIN_HORIZON, MAX_HORIZON);
  return Math.log(h / MIN_HORIZON) / Math.log(MAX_HORIZON / MIN_HORIZON);
}

export interface Calibration {
  // friction
  frictionPrimary: number;
  frictionSecondary: number;
  frictionRetained: number;
  exitReserve: number;
  // session multipliers
  sessionRegular: number;
  sessionExtended: number;
  sessionClosed: number;
  // signal weights
  wMomentum: number;
  wQuality: number;
  wLiquidity: number;
  wRisk: number;
  // stops
  stopAtrMult: number;
  maxStopPct: number;
  // fixed
  edgePrimary: number;
  edgeSecondary: number;
  edgeRetained: number;
  evidenceThreshold: number;
  evidenceScale: number;
  memberPupMin: number;
  primaryBand: number;
  retainFloor: number;
  minHurdle: number;
  opRisk: number;
  cashWait: number;
  minRR: number;
  frictionFloor: number;
  frictionCeiling: number;
  gamma: number;
}

// Spec §59: baseline friction seeds are 0.30 for primary/secondary/retained.
// The runtime multiplier surface adapts around that seed by role/regime/liquidity;
// here we let the horizon slide it upward (never below 0.30) because a longer
// hold has more path variance and deserves stricter discount.
// Spec §60 anchor is 15-min; at 5d we lift toward ~0.55/0.48/0.42.
//
// Spec §59: exit_reserve = 1.00 (full modeled future exit cost reserved). We
// never drop below that. Some horizon-adaptive cushion above 1.0 is allowed.
//
// Spec §17/§22/§59: cashWait is the opportunity cost of NOT waiting in cash.
// It must be non-zero, otherwise BUYs never compete against cash. We scale by
// horizon: short holds need only a small hurdle above cash; long holds must
// clear a larger implied risk-free/SPY continuation.
export function calibrate(horizonMin: number, ctx?: CalibrationContext): Calibration {
  const t = horizonT(horizonMin);

  // C3-2: horizon-lerp primaryBand (20 bps at 5m, 60 bps at 21d).
  const primaryBand = USE_PRIMARY_BAND_HORIZON_LERP ? lerp(t, 20, 60) : 30;

  // C3-3: horizon-scaled edgePrimary/Secondary/Retained.
  // hdEff = horizon in trading days, referenced to 5d baseline. Scale factor
  // √(hdEff/5) matches Grinold (2010) sub-linear IC growth in horizon.
  const hdEff = horizonMin / (6.5 * 60);
  const edgeScale = USE_EDGE_BAND_SCALED
    ? Math.max(0.5, Math.min(2.0, Math.sqrt(Math.max(1, hdEff) / 5)))
    : 1.0;

  // C3-4: cashWait SPY-scaled. Multiplier = spyReturn30d / max(spyVol30d, ε).
  // Falls back to 1.0 when either the env flag is off or the context lacks
  // the SPY inputs.
  const cashWaitBase = lerp(t, 2, 25);
  const spyMultiplier =
    USE_CASH_WAIT_SPY_SCALED
    && ctx?.spyReturn30d != null
    && ctx?.spyVol30d != null
    && ctx.spyVol30d > 0
      ? Math.max(0.25, Math.min(4.0, ctx.spyReturn30d / ctx.spyVol30d))
      : 1.0;
  const cashWait = cashWaitBase * spyMultiplier;

  return {
    frictionPrimary:   lerp(t, 0.30, 0.55),
    frictionSecondary: lerp(t, 0.30, 0.48),
    frictionRetained:  lerp(t, 0.30, 0.42),
    exitReserve:       lerp(t, 1.00, 1.15),
    sessionRegular:    1.0,
    // Legacy: lerp(t, 1.50, 1.05). Recal: Barclay-Hendershott (2003, 2004)
    // envelope — extended sessions run 3-4× regular; the recal lerp targets
    // 2.50 at 5m and 1.60 at 21d.
    sessionExtended:   USE_RECAL_SESSION_MULTS ? lerp(t, 2.50, 1.60) : lerp(t, 1.50, 1.05),
    // Legacy: lerp(t, 2.00, 1.10). Recal: multi-day holds bridge overnight
    // gaps carrying full adverse-selection risk (Barclay-Hendershott 2003).
    sessionClosed:     USE_RECAL_SESSION_MULTS ? lerp(t, 3.00, 1.80) : lerp(t, 2.00, 1.10),
    wMomentum:         lerp(t, 0.45, 0.25),
    wQuality:          lerp(t, 0.10, 0.40),
    wLiquidity:        lerp(t, 0.30, 0.05),
    wRisk:             lerp(t, 0.15, 0.30),
    stopAtrMult:       lerp(t, 0.8, 3.0),
    maxStopPct:        lerp(t, 0.02, 0.25),

    edgePrimary:       460 * edgeScale,
    edgeSecondary:     348 * edgeScale,
    edgeRetained:      200 * edgeScale,
    evidenceThreshold: 95,
    evidenceScale:     8,
    memberPupMin:      0.50,
    primaryBand,
    retainFloor:       40,
    minHurdle:         0,
    opRisk:            5,
    cashWait,
    minRR:             2.0,
    // C5-1: frictionFloor at 0.05 prevents (friction · roleEdge → 0)
    // pathologies. This is the ranking-time analog of the sizing-time
    // fractional-Kelly cap — every proposal is bounded above 0 to keep
    // the gate from silently rejecting any-and-all names in a bad regime.
    // Retained by design; see P2-PLAN.md C5-1.
    frictionFloor:     0.05,
    // C5-2: frictionCeiling at 1.0 prevents (fmult · pUpScale) from silently
    // clipping in gate.ts:59. Ratio 1.0 means "no reason to over-scale
    // roleEdge beyond its own bps value"; downstream pUpScale is a separate
    // multiplier so the two shouldn't compound past 1.0.
    frictionCeiling:   1.0,
    gamma:             1.0,
  };
}
