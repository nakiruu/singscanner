// Stop / target levels and the star score.
// Source: docs/instructions2.md "Stop/target" and "Stars".

import { clamp } from "./stats";
import type { Calibration } from "./horizon";

export interface StopTargetInput {
  ref: number;          // costBasis for held, current price for new
  volAnn: number;       // annualized vol, e.g. 0.32
  holdingDays: number;  // expected holding period in trading days
  composite: number;    // 0..100
  confidence: number;   // 0..1
  currentPrice: number; // for RR denominator
  calib: Calibration;
}

export interface StopTargetResult {
  stop: number;
  target: number;
  rr: number;
  dailyVol: number;
  atr: number;
  targetMove: number;   // fractional, e.g. 0.045 = +4.5%
}

export function computeStopTarget(i: StopTargetInput): StopTargetResult {
  const dailyVol = i.volAnn / Math.sqrt(252);
  // Python compute_levels uses max(holding_days, 1) — guard against intraday horizons
  // collapsing the sqrt term to zero.
  const hdEff = Math.max(i.holdingDays, 1);
  const atr = dailyVol * i.ref * Math.sqrt(hdEff);

  // Stop = ref - clamped(ATR-scaled stop in dollars)
  // Python order: first cap to maxStopPct, then floor at 1%.
  let stopDollars = i.calib.stopAtrMult * atr;
  stopDollars = Math.min(stopDollars, i.ref * i.calib.maxStopPct);
  stopDollars = Math.max(stopDollars, i.ref * 0.01);
  const stop = i.ref - stopDollars;

  // Target move scales with daily vol, signal strength, and confidence.
  // clamp((composite-40)/30, 0.3, 1.2): below 40 we still want some target, above 70 we cap aggression.
  const compMult = clamp((i.composite - 40) / 30, 0.3, 1.2);
  const confMult = clamp(i.confidence, 0.5, 1.0);
  // Python floors target_move_pct at 0.005 (+0.5%) so we never show a zero target.
  const targetMove = Math.max(
    1.5 * dailyVol * Math.sqrt(hdEff) * compMult * confMult,
    0.005,
  );

  // Floor target by minRR multiple of the risk leg so we never present a sub-minRR setup.
  const target = Math.max(i.ref * (1 + targetMove), i.ref + i.calib.minRR * (i.ref - stop));

  // RR vs *current* price (so live-quote drift is reflected).
  const denom = i.currentPrice - stop;
  const rrRaw = denom > 0 ? (target - i.currentPrice) / denom : i.calib.minRR;
  const rr = Math.max(rrRaw, i.calib.minRR);

  return { stop, target, rr, dailyVol, atr, targetMove };
}

export interface StarScoreInput {
  netSurplus: number;   // post-cost net edge in bps
  confidence: number;   // 0..1
  risk: number;         // 0..100 risk family score (higher = safer)
  targetUpPct: number;  // target move in % (e.g. 4.5 not 0.045)
}

// Composite "starworthiness". Top 5 BUYs by this score get star=true.
// Python clamps net_surplus_bps to 0 (max(net, 0)) so negative-edge BUYs
// can't compete for a star.
export function starScore(i: StarScoreInput): number {
  return (
    Math.max(i.netSurplus, 0) *
    i.confidence *
    (Math.max(i.risk, 20) / 50) *
    (1 + i.targetUpPct / 20)
  );
}
