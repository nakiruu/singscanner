// Forecast: composite -> P_up -> mu, evidence.
// Source: docs/instructions2.md "Forecast"

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

export function composite(s: SignalScores, c: Calibration): number {
  return (
    c.wMomentum  * s.momentum  +
    c.wQuality   * s.quality   +
    c.wLiquidity * s.liquidity +
    c.wRisk      * s.risk
  );
}

export function forecast({ signals, confidence, volAnn, edgeHorizonMin, calib }: ForecastInput): ForecastResult {
  const comp = composite(signals, calib);
  const pUp = sigmoid((comp - 50) / 18);
  const horizonFrac = edgeHorizonMin / TRADING_MIN_PER_YEAR;
  const condUpside = volAnn * Math.sqrt(horizonFrac) * 10_000; // bps
  const posEdge = Math.max(pUp - 0.5, 0) * condUpside;
  const mu = confidence * posEdge;
  const evidence = confidence * Math.max(comp - 50, 0) * calib.evidenceScale;
  return { composite: comp, pUp, condUpside, posEdge, mu, evidence };
}

// ML boost adjustments. Returns new {confidence, evidence}.
// Source: "ML boost" section.
export function applyMlBoost(
  base: { confidence: number; evidence: number },
  mlScore: number | null,
  kronos: { p_up_a: number | null; p_up_b: number | null } | null,
): { confidence: number; evidence: number } {
  let { confidence, evidence } = base;
  if (mlScore != null && mlScore > 50) {
    evidence *= 1 + ((mlScore - 50) / 50) * 0.4;
  }
  if (kronos && kronos.p_up_a != null && kronos.p_up_b != null) {
    const agree = kronos.p_up_a > 0.5 && kronos.p_up_b > 0.5;
    const disagree = (kronos.p_up_a > 0.5) !== (kronos.p_up_b > 0.5);
    if (agree) {
      confidence *= 1.15;
      evidence *= 1.10;
    } else if (disagree) {
      confidence *= 0.85;
    }
  }
  return { confidence, evidence };
}
