// Forecast: composite -> P_up -> mu, evidence.
// Source: SPECLIST §6 (expected return), §8 (confidence), §57 (source-conviction).
//
// The engine is deliberately non-ML per SPECLIST §68: the practical implementation
// keeps trading behavior on the validated source-selector surface and does not
// depend on a black-box booster. Signal families (§4) are the sole evidence input.

import { sigmoid } from "./stats";
import type { Calibration } from "./horizon";

export interface SignalScores {
  momentum: number;  // 0..100
  quality: number;   // 0..100
  liquidity: number; // 0..100
  risk: number;      // 0..100 (higher = safer)
}

export interface ForecastInput {
  signals: SignalScores;
  confidence: number;   // 0..1
  volAnn: number;       // annualized volatility (e.g. 0.32 = 32%)
  edgeHorizonMin: number;
  calib: Calibration;
}

export interface ForecastResult {
  composite: number;   // 0..100
  pUp: number;         // 0..1
  condUpside: number;  // bps
  posEdge: number;     // bps
  mu: number;          // bps, confidence-weighted
  evidence: number;
}

const TRADING_MIN_PER_YEAR = 60 * 6.5 * 252;

export interface CompositeOpts {
  // Optional cost-aware penalty in bps. When supplied, the composite is
  // shifted down by `costPenaltyBps / c.evidenceScale` so downstream ranking
  // is on `edge − cost` rather than raw edge — Frazzini/Israel/Moskowitz
  // (2018) show cost-inside ranking dominates cost-then-filter in the
  // presence of tight friction budgets. Scale by evidenceScale so the shift
  // is comparable to the 0..100 composite domain.
  //
  // CALIBRATION HAZARD: enabling this shifts pUp distribution, which then
  // shifts starScore, evidenceThreshold, and memberPupMin cutoffs. Revisit
  // those before enabling globally.
  costPenaltyBps?: number;
}

export function composite(
  s: SignalScores,
  c: Calibration,
  opts?: CompositeOpts,
): number {
  const raw =
    c.wMomentum  * s.momentum  +
    c.wQuality   * s.quality   +
    c.wLiquidity * s.liquidity +
    c.wRisk      * s.risk;
  if (opts?.costPenaltyBps != null && opts.costPenaltyBps > 0) {
    const shift = opts.costPenaltyBps / Math.max(1, c.evidenceScale);
    return raw - shift;
  }
  return raw;
}

export function forecast({ signals, confidence, volAnn, edgeHorizonMin, calib }: ForecastInput): ForecastResult {
  const comp = composite(signals, calib);
  const pUp = sigmoid((comp - 50) / 18);
  const horizonFrac = edgeHorizonMin / TRADING_MIN_PER_YEAR;
  const condUpside = volAnn * Math.sqrt(horizonFrac) * 10_000; // bps
  // SPECLIST §6: positive_edge = max(P_up - 0.5, 0) · conditional_upside.
  const posEdge = Math.max(pUp - 0.5, 0) * condUpside;
  // SPECLIST §8: μ_adj = q · μ + (1-q) · 0 (conservative shrinkage toward zero).
  const mu = confidence * posEdge;
  const evidence = confidence * Math.max(comp - 50, 0) * calib.evidenceScale;
  return { composite: comp, pUp, condUpside, posEdge, mu, evidence };
}
