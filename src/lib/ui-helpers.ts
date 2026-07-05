import type { Decision, ScanRow } from "@/lib/engine/types";

/** Recommended position sizing (% of book) derived from net surplus & confidence. */
export function recommendedSizing(row: ScanRow): number {
  const netComponent = Math.max(0, row.net) / 100; // bps → unit-ish
  const raw = 0.5 + netComponent * 1.5 + row.confidence * 1.5;
  // Clamp into 0.5-5.0% band.
  const pct = Math.max(0.5, Math.min(5, raw));
  return Math.round(pct * 10) / 10;
}

/** Required model edge expressed as % of cost wall (0..130 clamp). */
export function gateFillPct(row: ScanRow): number {
  if (row.cost <= 0) return 0;
  return Math.max(0, Math.min(130, (row.modelEdge / row.cost) * 100));
}

/** Net surplus expressed as +/- % of cost wall. */
export function gateOverflowPct(row: ScanRow): number {
  if (row.cost <= 0) return 0;
  return Math.max(-100, Math.min(100, (row.net / row.cost) * 100));
}

/** Pass percentage for the momentum gate (heuristic for UI display). */
export function momentumPassPct(row: ScanRow): number {
  const weighted = row.momentum * 0.6 + row.composite * 0.4;
  return Math.round(Math.max(0, Math.min(100, weighted)));
}

/** Pass percentage for the liquidity floor (heuristic for UI display). */
export function liquidityPassPct(row: ScanRow): number {
  const weighted = row.liquidity * 0.7 + Math.max(0, 100 - row.spreadBps * 5) * 0.3;
  return Math.round(Math.max(0, Math.min(100, weighted)));
}

/** Naive symbol → exchange mapping for the demo (defaults to NAS). */
export function exchangeFor(symbol: string): string {
  const NYSE = new Set(["BAC", "JPM", "WMT", "DIS", "GE", "F", "T", "KO"]);
  return NYSE.has(symbol) ? "NYSE" : "NAS";
}

export type DecisionTone = "primary" | "warn" | "error" | "neutral" | "info" | "success";

// SPECLIST §29/§30: SELL and ROTATE are actionable state changes; BUY too.
// HOLD is informational. WAIT/HOLD-CASH are neutral non-actions.
export function decisionTone(d: Decision): DecisionTone {
  switch (d) {
    case "BUY":
      return "success";
    case "SELL":
      return "error";
    case "ROTATE":
      return "primary";
    case "WAIT":
      return "warn";
    case "HOLD":
    case "HOLD-CASH":
    default:
      return "info";
  }
}

/** Map signal score (0-100) to a tier color. */
export function signalTier(v: number): "high" | "mid" | "low" {
  if (v >= 66) return "high";
  if (v >= 33) return "mid";
  return "low";
}
