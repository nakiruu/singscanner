import type { Decision, ScanRow } from "@/lib/engine/types";
import type { RotationCandidate } from "@/lib/engine/rotation";

// Serialized PortfolioEntry as returned by /api/portfolio (dates as ISO strings).
export interface PortfolioEntry {
  id: string;
  userId: string;
  symbol: string;
  qty: number;
  costBasis: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddPositionInput {
  symbol: string;
  qty: number;
  costBasis: number;
  notes?: string | null;
}

export interface UpdatePositionInput {
  qty?: number;
  costBasis?: number;
  notes?: string | null;
}

export interface PortfolioOverlayRow {
  symbol: string;
  qty: number;
  costBasis: number;
  currentPrice: number | null;
  scanRow: ScanRow | null;
  pnlDollars: number;
  pnlPercent: number;

  // Legacy price levels (kept for downstream code).
  stop: number;
  target: number;
  rr: number;

  // Spec §11/§15/§26: honest split price levels.
  // fairValueTarget: vol-implied modeled target price (no minRR clamp).
  // takeProfitLimit: limit price for a TP sell (inside fair value by ½ spread).
  fairValueTarget: number;
  takeProfitLimit: number;
  // stopLimit: limit paired with the stop trigger (below trigger by a spread).
  stopLimit: number;
  // trailingStop*: same ATR distance but anchored to current price for
  // positions that have appreciated (§29 rebound-risk protection).
  trailingStop: number;
  trailingStopLimit: number;
  // minRRTarget + minRRActive: reference target if a 2R floor is required.
  // minRRActive = true when this floor is above the vol-implied target and
  // would override it under the old logic.
  minRRTarget: number;
  minRRActive: boolean;

  decision: Decision;
  reason: string;
  // Spec §30: when decision === "ROTATE", the destination symbol.
  rotateTo?: string;
  // Spec §30: net advantage of the best cleared rotation in bps (0 if none).
  bestRotationBps?: number;
  // All scored rotation candidates for this holding (up to N), so the UI can
  // show a fanned-out list of alternatives — the scanner never auto-executes.
  rotationCandidates: RotationCandidate[];
}
