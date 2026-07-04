// Horizon calibration. All "minutes" are trading minutes.
// Source: docs/instructions2.md "Horizon calibration"

import { clamp, lerp } from "./stats";

const MIN_HORIZON = 5;    // 5 minutes
const MAX_HORIZON = 8190; // 21 trading days * 6.5h * 60min

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
export function calibrate(horizonMin: number): Calibration {
  const t = horizonT(horizonMin);
  return {
    frictionPrimary:   lerp(t, 0.30, 0.55),
    frictionSecondary: lerp(t, 0.30, 0.48),
    frictionRetained:  lerp(t, 0.30, 0.42),
    exitReserve:       lerp(t, 1.00, 1.15),
    sessionRegular:    1.0,
    sessionExtended:   lerp(t, 1.50, 1.05),
    sessionClosed:     lerp(t, 2.00, 1.10),
    wMomentum:         lerp(t, 0.45, 0.25),
    wQuality:          lerp(t, 0.10, 0.40),
    wLiquidity:        lerp(t, 0.30, 0.05),
    wRisk:             lerp(t, 0.15, 0.30),
    stopAtrMult:       lerp(t, 0.8, 3.0),
    maxStopPct:        lerp(t, 0.02, 0.25),

    edgePrimary:       460,
    edgeSecondary:     348,
    edgeRetained:      200,
    evidenceThreshold: 95,
    evidenceScale:     8,
    memberPupMin:      0.50,
    primaryBand:       120,
    retainFloor:       40,
    minHurdle:         0,
    opRisk:            5,
    cashWait:          lerp(t, 2, 25),
    minRR:             2.0,
    frictionFloor:     0.05,
    frictionCeiling:   1.0,
    gamma:             1.0,
  };
}
