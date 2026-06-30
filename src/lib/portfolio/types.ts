import type { Decision, ScanRow } from "@/lib/engine/types";

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
  stop: number;
  target: number;
  rr: number;
  decision: Decision;
  reason: string;
}
