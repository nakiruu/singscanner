// Pricing: stop-loss, take-profit, and the horizon ladder.
//
// SPECLIST §11/§15/§16/§26 wants entry- and exit-friction-aware price levels:
//   • fair-value target = the vol-implied modeled price at horizon (honest).
//   • take-profit limit = a sell limit sitting inside fair value by ~½ exit
//     spread + missed-fill hurdle so the order actually fills.
//   • stop trigger = ATR-scaled protective price.
//   • stop limit  = the limit price paired with the stop trigger, accounting
//     for exit spread so the fill doesn't slip through.
//   • trailing stop = same ATR distance, anchored to current price instead of
//     entry, for held positions that have appreciated.
//
// The minRR floor is preserved but exposed as a *separate* target instead of
// silently overriding the vol-implied one. Callers see both and decide.

import { clamp } from "./stats";
import type { Calibration } from "./horizon";

const TRADING_DAYS_PER_YEAR = 252;

export interface StopTargetInput {
  ref: number;                 // entry / cost basis for RR anchoring
  volAnn: number;              // annualized realized vol, e.g. 0.32
  holdingDays: number;         // expected holding period in trading days
  composite: number;           // 0..100
  confidence: number;          // 0..1
  currentPrice: number;        // used for trailing stop + RR denominator
  spreadBps: number;           // per-row exit spread, in bps of price
  calib: Calibration;
}

export interface StopTargetResult {
  atr: number;                 // dollar amount of ATR over holdingDays
  dailyVol: number;            // fractional
  targetMove: number;          // fractional vol-implied move from ref

  // Stop side
  stop: number;                // trigger price (from `ref`)
  stopLimit: number;           // limit price for stop-loss order (below trigger)
  trailingStop: number;        // trigger price anchored to currentPrice
  trailingStopLimit: number;   // limit price for the trailing stop

  // Target side
  fairValueTarget: number;     // vol-implied target price at horizon
  takeProfitLimit: number;     // limit price for TP order (inside fair value)
  minRRTarget: number;         // ref + minRR · (ref - stop)   [reference only]
  minRRActive: boolean;        // true when minRRTarget > fairValueTarget

  // Legacy field: the higher of fairValue vs minRR (kept for the star scorer
  // and any downstream code that historically read `target`).
  target: number;
  rr: number;                  // RR of fair-value target against currentPrice
  rrMinRR: number;             // RR when the minRR floor is used instead
}

// ½-spread haircut in fractional form. `spreadBps` is a bps quote-spread.
// We use a full spread for stop-limit (need to catch a fill through a
// widening market) and ½ spread for take-profit-limit (limit orders inside
// the touch are already price-improved by ½ spread on average).
function halfSpreadFrac(spreadBps: number): number {
  return clamp(spreadBps, 0, 1000) / 2 / 10_000;
}
function fullSpreadFrac(spreadBps: number): number {
  return clamp(spreadBps, 0, 1000) / 10_000;
}

export function computeStopTarget(i: StopTargetInput): StopTargetResult {
  const dailyVol = i.volAnn / Math.sqrt(TRADING_DAYS_PER_YEAR);
  // SPECLIST §16 note: for intraday horizons collapsing to zero, floor at 1d.
  const hdEff = Math.max(i.holdingDays, 1);
  const atr = dailyVol * i.ref * Math.sqrt(hdEff);

  // --- Stop (from entry / cost basis) ---
  let stopDollars = i.calib.stopAtrMult * atr;
  stopDollars = Math.min(stopDollars, i.ref * i.calib.maxStopPct);
  stopDollars = Math.max(stopDollars, i.ref * 0.01);
  const stop = i.ref - stopDollars;

  // Stop-limit sits BELOW the trigger by a full spread. A stop-loss triggers a
  // market/limit sell; if the market has moved through the trigger, we still
  // want the limit to catch a fill on the way down.
  const stopLimit = stop * (1 - fullSpreadFrac(i.spreadBps));

  // --- Trailing stop (anchored to current price) ---
  // Uses the same ATR distance but never sits ABOVE the entry-anchored stop
  // (trailing only moves in the profit direction).
  const trailingStopRaw = i.currentPrice - stopDollars;
  const trailingStop = Math.max(trailingStopRaw, stop);
  const trailingStopLimit = trailingStop * (1 - fullSpreadFrac(i.spreadBps));

  // --- Fair-value target (vol-implied) ---
  // 1.5× the horizon standard deviation, scaled by composite strength and
  // confidence. This is the honest expected upside — no minRR clamp.
  const compMult = clamp((i.composite - 40) / 30, 0.3, 1.2);
  // Confidence floor is 0 (spec §8: uncertain signal → shrink to prior).
  const confMult = clamp(i.confidence, 0, 1.0);
  const targetMove = Math.max(
    1.5 * dailyVol * Math.sqrt(hdEff) * compMult * confMult,
    // 0.5% floor so we never render exactly 0 — display fallback only.
    0.005,
  );
  const fairValueTarget = i.ref * (1 + targetMove);

  // Take-profit limit sits INSIDE fair value by ½ exit spread — the price a
  // limit-sell would actually fill at with high probability.
  const takeProfitLimit = fairValueTarget * (1 - halfSpreadFrac(i.spreadBps));

  // --- Min-RR reference target (separate, for optional display) ---
  const minRRTarget = i.ref + i.calib.minRR * (i.ref - stop);
  const minRRActive = minRRTarget > fairValueTarget;

  // Legacy: keep `target` = higher of the two so the star scorer + old UI
  // continue to work. New callers should use fairValueTarget directly.
  const target = Math.max(fairValueTarget, minRRTarget);

  const denom = i.currentPrice - stop;
  const rr = denom > 0 ? Math.max(0, (fairValueTarget - i.currentPrice) / denom) : 0;
  const rrMinRR = denom > 0 ? Math.max(0, (minRRTarget - i.currentPrice) / denom) : 0;

  return {
    atr,
    dailyVol,
    targetMove,
    stop,
    stopLimit,
    trailingStop,
    trailingStopLimit,
    fairValueTarget,
    takeProfitLimit,
    minRRTarget,
    minRRActive,
    target,
    rr,
    rrMinRR,
  };
}

// -- Horizon ladder (SPECLIST §7) -----------------------------------------

export interface HorizonRungInput {
  spec: string;   // "1d", "3d", ...
  minutes: number; // trading minutes for the horizon
}

export interface HorizonRung {
  horizonSpec: string;
  horizonMin: number;
  holdingDays: number;
  targetMove: number;         // fractional
  fairValueTarget: number;    // absolute price
}

export interface HorizonLadderInput {
  ref: number;
  volAnn: number;
  composite: number;
  confidence: number;
  rungs: readonly HorizonRungInput[];
}

// Fair-value target across a set of horizons. Same math as computeStopTarget's
// target branch, no minRR floor. Lets the UI show a term structure so users
// can pick their own hold instead of the scanner picking one for them.
export function computeHorizonLadder(i: HorizonLadderInput): HorizonRung[] {
  const dailyVol = i.volAnn / Math.sqrt(TRADING_DAYS_PER_YEAR);
  const compMult = clamp((i.composite - 40) / 30, 0.3, 1.2);
  const confMult = clamp(i.confidence, 0, 1.0);
  return i.rungs.map((r) => {
    const holdingDays = Math.max(r.minutes / 390, 1 / 390);
    const hdEff = Math.max(holdingDays, 1);
    const targetMove = Math.max(
      1.5 * dailyVol * Math.sqrt(hdEff) * compMult * confMult,
      0.005,
    );
    return {
      horizonSpec: r.spec,
      horizonMin: r.minutes,
      holdingDays,
      targetMove,
      fairValueTarget: i.ref * (1 + targetMove),
    };
  });
}

// Default horizon set used by the scanner. Trading minutes:
//   1d  =  390
//   3d  = 1170
//   5d  = 1950
//   10d = 3900
export const DEFAULT_HORIZON_RUNGS: readonly HorizonRungInput[] = [
  { spec: "1d",  minutes: 390 },
  { spec: "3d",  minutes: 1170 },
  { spec: "5d",  minutes: 1950 },
  { spec: "10d", minutes: 3900 },
];

// -- Star score -----------------------------------------------------------

export interface StarScoreInput {
  netSurplus: number;   // post-cost net edge in bps
  confidence: number;   // 0..1
  risk: number;         // 0..100 risk family score (higher = safer)
  targetUpPct: number;  // fair-value target upside in % (e.g. 4.5 not 0.045)
}

// Composite "starworthiness". Top 5 BUYs by this score get star=true.
// Now uses fair-value upside (not the minRR-inflated legacy target), so the
// scorer sees the honest vol-implied upside per SPECLIST §6.
export function starScore(i: StarScoreInput): number {
  return (
    Math.max(i.netSurplus, 0) *
    i.confidence *
    (Math.max(i.risk, 20) / 50) *
    (1 + i.targetUpPct / 20)
  );
}
