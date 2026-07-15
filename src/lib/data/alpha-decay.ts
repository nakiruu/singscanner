// Alpha-decay τ per family.
//
// Given the family-IC ladder from B6-S5 (computeFamilyIC), fit a log-linear
// decay curve to extract the family's characteristic half-life τ:
//
//   log(|IC(h)|) = log(IC_0) - h / τ
//
// τ is the horizon (in trading days) over which the family's ranked
// information content decays by 1/e ≈ 37%. Israel & Moskowitz (2013 JFE)
// retire signals when their rolling 6m IC drops below 50% of baseline —
// τ gives a principled, IC-consumption-adjusted retirement criterion.
//
// Pure module. Consumes FamilyICReport from family-ic.ts.

import type { FamilyICReport, FamilyICPoint, SignalFamily } from "./family-ic";

// Trading days per horizon spec. Matches horizon.ts:HORIZON_PRESET_MINUTES
// but expressed as calendar-friendly integer days for the τ fit.
const HORIZON_DAYS: Record<"3d" | "5d" | "10d", number> = {
  "3d": 3,
  "5d": 5,
  "10d": 10,
};

export interface AlphaDecayPoint {
  family: SignalFamily;
  // Fitted half-life in trading days. Positive = decays (typical).
  // Negative = IC GROWS with horizon (unusual — suggests a longer-term
  // signal mis-classified as short-term). Infinity = no decay detected
  // (either flat IC or too-noisy fit).
  tauDays: number;
  // Fitted IC_0 (intercept). Sign carries the direction of the effect.
  ic0: number;
  // Number of horizons the fit was performed on. Fits with fewer than 2
  // horizons return NaN tau (undefined slope).
  nHorizons: number;
  // Simple R² of the log-linear fit — a check on whether the exponential
  // model actually explains the IC(h) shape. Low R² (< 0.5) suggests the
  // family doesn't have a clean exponential decay — either a compound
  // signal or too noisy to fit.
  fitR2: number;
  // Retirement flag: current τ < 3 trading days. At τ < 3d the signal has
  // essentially no useful horizon runway; Israel-Moskowitz retirement
  // territory.
  retirementCandidate: boolean;
}

export interface AlphaDecayReport {
  generatedAt: string;
  windowDays: number;
  points: AlphaDecayPoint[];
}

const FAMILIES: SignalFamily[] = ["momentum", "quality", "liquidity", "risk"];
const RETIREMENT_TAU_DAYS = 3;

// Compute per-family τ from an existing FamilyICReport.
//
// The FamilyICReport gives IC per (family, horizon). We regress
// log|IC(h)| on h across the horizon ladder and interpret slope as -1/τ.
// Zero-IC and near-zero-IC points (|IC| < 1e-4) are dropped to keep the
// log finite.
export function computeAlphaDecay(icReport: FamilyICReport): AlphaDecayReport {
  const points: AlphaDecayPoint[] = [];

  for (const family of FAMILIES) {
    const familyPoints = icReport.points.filter((p) => p.family === family);
    const observations: Array<{ h: number; logAbsIc: number; ic: number }> = [];
    for (const p of familyPoints) {
      const horizonKey = p.horizon as keyof typeof HORIZON_DAYS;
      const h = HORIZON_DAYS[horizonKey];
      if (h == null) continue;
      const absIc = Math.abs(p.ic);
      if (absIc < 1e-4) continue;
      observations.push({ h, logAbsIc: Math.log(absIc), ic: p.ic });
    }

    if (observations.length < 2) {
      points.push({
        family,
        tauDays: Number.NaN,
        ic0: 0,
        nHorizons: observations.length,
        fitR2: 0,
        retirementCandidate: false,
      });
      continue;
    }

    // OLS on (h, logAbsIc). slope = -1/τ; intercept = log(IC_0).
    const n = observations.length;
    const meanH = observations.reduce((s, o) => s + o.h, 0) / n;
    const meanY = observations.reduce((s, o) => s + o.logAbsIc, 0) / n;
    let num = 0;
    let den = 0;
    for (const o of observations) {
      num += (o.h - meanH) * (o.logAbsIc - meanY);
      den += (o.h - meanH) ** 2;
    }
    const slope = den > 0 ? num / den : 0;
    const intercept = meanY - slope * meanH;

    // R²
    let ssRes = 0;
    let ssTot = 0;
    for (const o of observations) {
      const predicted = intercept + slope * o.h;
      ssRes += (o.logAbsIc - predicted) ** 2;
      ssTot += (o.logAbsIc - meanY) ** 2;
    }
    const fitR2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

    // Signed IC_0 uses the sign of the majority-IC in the fit window.
    const posCount = observations.filter((o) => o.ic > 0).length;
    const sign = posCount >= n / 2 ? 1 : -1;
    const ic0 = sign * Math.exp(intercept);

    // slope = -1/τ. Positive slope means IC grows with h → tau negative
    // (no decay). Cap at ±10_000 to keep JSON-serializable.
    let tauDays: number;
    if (slope === 0) {
      tauDays = Number.POSITIVE_INFINITY;
    } else {
      const raw = -1 / slope;
      tauDays = Math.max(-10_000, Math.min(10_000, raw));
    }

    const retirementCandidate = tauDays > 0 && tauDays < RETIREMENT_TAU_DAYS;

    points.push({
      family,
      tauDays: round2(tauDays),
      ic0: round4(ic0),
      nHorizons: n,
      fitR2: round4(fitR2),
      retirementCandidate,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays: icReport.windowDays,
    points,
  };
}

function round2(x: number): number {
  if (!Number.isFinite(x)) return x;
  return Math.round(x * 100) / 100;
}
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
