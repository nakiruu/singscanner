// Shared scan result types.

export type Decision = "BUY" | "WAIT" | "HOLD-CASH" | "SELL" | "HOLD" | "ROTATE";
export type Role = "primary" | "secondary" | "retained" | "none";

export interface ScanRow {
  symbol: string;
  price: number;
  spreadBps: number;
  relVol: number;
  momentum: number;
  quality: number;
  liquidity: number;
  risk: number;
  composite: number;
  pUp: number;
  confidence: number;
  mu: number;          // bps
  evidence: number;
  role: Role;
  decision: Decision;
  modelEdge: number;   // bps
  cost: number;        // bps
  net: number;         // bps
  star: boolean;
  starScore: number | null; // buy ranking metric (null for non-BUY rows)
  source: string;      // alpaca | mock | yf
  exchange?: string;   // NYSE | NASDAQ | etc — set by universe lookup

  // Spec §57: target weight if this row is in the constructed target book.
  // 0 for non-qualifying rows (cash residual absorbs the rest).
  targetWeight: number;
  // Spec §21: concentration penalty in bps charged against modelEdge when
  // the target weight exceeds the comfortable single-name weight.
  concentrationBps: number;
}

export interface ScanSnapshot {
  generatedAt: string;       // ISO
  horizon: string;           // e.g. "3d"
  universe: string;          // "auto" or list label
  symbolsScanned: number;
  rows: ScanRow[];
  // Spec §57: residual cash weight after target portfolio construction.
  cashWeight: number;
}
