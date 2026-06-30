// Shared scan result types.

export type Decision = "BUY" | "WAIT" | "HOLD-CASH" | "SELL" | "HOLD";
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
  mlScore: number | null;
  role: Role;
  decision: Decision;
  modelEdge: number;   // bps
  cost: number;        // bps
  net: number;         // bps
  star: boolean;
  source: string;      // alpaca | mock | yf
}

export interface ScanSnapshot {
  generatedAt: string;       // ISO
  horizon: string;           // e.g. "3d"
  universe: string;          // "auto" or list label
  symbolsScanned: number;
  rows: ScanRow[];
}
