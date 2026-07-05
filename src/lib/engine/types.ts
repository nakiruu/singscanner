// Shared scan result types.

import type { HorizonRung } from "./levels";
import type { ConfidenceFactors } from "./confidence";

export type Decision = "BUY" | "WAIT" | "HOLD-CASH" | "SELL" | "HOLD" | "ROTATE";
export type Role = "primary" | "secondary" | "retained" | "none";

export interface ScanRow {
  symbol: string;
  price: number;
  spreadBps: number;
  relVol: number;

  // Signal families (SPECLIST §4)
  momentum: number;
  quality: number;
  liquidity: number;
  risk: number;
  composite: number;
  pUp: number;

  // Uncertainty (§8)
  confidence: number;
  // Per-cause breakdown so callers can explain WHY confidence is low.
  confidenceFactors: ConfidenceFactors;

  // Forecast + evidence
  mu: number;                    // bps
  evidence: number;
  // Realized annualized vol used for this row (§6 √t scaling). Downstream
  // overlays should pass THIS, not a fleet-wide guess, into computeStopTarget.
  volAnn: number;

  // Gate outputs (§59)
  role: Role;
  decision: Decision;
  modelEdge: number;             // bps
  cost: number;                  // bps — total required hurdle
  net: number;                   // bps — modelEdge − cost − cashWait − concentration
  // Breakdown of `cost` so callers can render an audit-friendly gate tooltip.
  cEntry: number;                // bps
  cExit: number;                 // bps (reserved)
  cQueue: number;                // bps
  cMemory: number;               // bps
  concentrationBps: number;      // bps subtracted from modelEdge (§21)

  // Star ranking
  star: boolean;
  starScore: number | null;

  // Portfolio construction (§57)
  targetWeight: number;

  // Multi-horizon fair-value target ladder (§7). Same math as the row's
  // primary target computation but evaluated at 1d / 3d / 5d / 10d so users
  // can pick their own hold.
  horizonLadder: HorizonRung[];

  // Price levels for the row's primary horizon (SPECLIST §11/§15/§26).
  // Populated for BUY rows; 0 for non-BUY (WAIT/HOLD-CASH) since no exit
  // planning applies there.
  //   stopPx        = protective trigger price (ATR-scaled from ref).
  //   stopLimitPx   = paired limit price (below trigger by a full spread).
  //   fairValueTargetPx = vol-implied target price (honest, no minRR clamp).
  //   takeProfitLimitPx = TP limit price (inside fair value by ½ spread).
  stopPx: number;
  stopLimitPx: number;
  fairValueTargetPx: number;
  takeProfitLimitPx: number;

  // Carry / gap warnings (§16). true when the current bar-to-next-session
  // gap crosses a weekend/holiday, so exit-EV should be discounted.
  crossesWeekend: boolean;
  gapDays: number;

  // Provenance
  source: string;      // alpaca | mock | yf
  exchange?: string;   // NYSE | NASDAQ | ...
}

export interface ScanSnapshot {
  generatedAt: string;
  horizon: string;
  universe: string;
  symbolsScanned: number;
  rows: ScanRow[];
  cashWeight: number;
}
