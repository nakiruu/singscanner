// Sell / hold / rotate decision for a currently-held position.
//
// Spec §29 SellEV = avoided_future_loss + opp_value_of_freed_capital
//                  - sell_execution_cost - rebound_risk - op_cost
// Spec §31 HoldEV = expected_future_return - carry_cost - risk_cost - opp_cost_of_capital
// Spec §30 RotationEV(a -> b) = EV_hold_b - EV_hold_a - sell_cost_a - buy_cost_b - transition
//
// Priority (spec §47: never sell without checking EV):
//   1. Hard rules — stop / take-profit (mechanical protection).
//   2. Economic rules — compare HoldEV vs SellEV vs best RotateEV vs cash hurdle.

import type { Decision } from "./types";
import type { RotationCandidate } from "./rotation";

export interface SellInput {
  price: number;
  stop: number;
  target: number;
  composite: number;         // 0..100
  isMember: boolean;         // currently a long-side member
  isRetained: boolean;       // role == "retained"

  // Economic inputs (spec §29/§30/§31). All optional so existing callers
  // don't break; when omitted we fall back to the mechanical rules.
  holdNetBps?: number;       // HoldEV in bps (0 = neutral)
  exitCostBps?: number;      // sell-side execution cost bps
  cashHurdleBps?: number;    // opportunity cost of cash floor
  bestRotation?: RotationCandidate | null;
}

export interface SellResult {
  decision: Decision;        // "SELL" | "HOLD" | "ROTATE"
  reason: string;
  rotateTo?: string;         // populated when decision === "ROTATE"
}

export function sellDecision(s: SellInput): SellResult {
  // --- Hard rules (mechanical risk protection) — always run first ---
  if (s.price <= s.stop)   return { decision: "SELL", reason: "stop" };
  if (s.price >= s.target) return { decision: "SELL", reason: "take-profit" };

  // --- Economic rules (spec §29/§30/§31) ---
  // If we have the after-cost numbers, use them. RotateEV beats SellEV beats HoldEV.
  const hasEconomics =
    s.holdNetBps !== undefined && s.exitCostBps !== undefined && s.cashHurdleBps !== undefined;

  if (hasEconomics) {
    const holdEv = s.holdNetBps ?? 0;
    const cashHurdle = s.cashHurdleBps ?? 0;
    // Spec §29: SellEV = value of freed capital - exit cost.
    // We proxy "value of freed capital" as the cash hurdle (opportunity cost
    // that cash implies you should reinvest at) minus the current hold's EV.
    const sellEv = cashHurdle - holdEv - (s.exitCostBps ?? 0);
    const rotateEv = s.bestRotation?.cleared ? s.bestRotation.netAdvantageBps : -Infinity;

    // Rotate wins if its EV clears both HoldEV and its internal hurdle.
    if (rotateEv > 0 && rotateEv > sellEv) {
      return {
        decision: "ROTATE",
        reason: `rotate→${s.bestRotation!.toSymbol}`,
        rotateTo: s.bestRotation!.toSymbol,
      };
    }
    // Sell to cash wins if SellEV > HoldEV.
    if (sellEv > 0) {
      return { decision: "SELL", reason: "sell-ev" };
    }
    // Otherwise hold, but tag reason by role.
    if (s.isMember)   return { decision: "HOLD", reason: "hold-ev" };
    if (s.isRetained) return { decision: "HOLD", reason: "retained" };
    return { decision: "HOLD", reason: "hold-ev" };
  }

  // --- Fallback: signal-only heuristics (kept for callers without economics) ---
  if (s.composite < 38) return { decision: "SELL", reason: "reversal" };
  if (s.composite < 45 && !s.isMember && !s.isRetained) {
    return { decision: "SELL", reason: "deteriorated" };
  }
  if (s.isMember)        return { decision: "HOLD", reason: "strong" };
  if (s.isRetained)      return { decision: "HOLD", reason: "retained" };
  if (s.composite >= 48) return { decision: "HOLD", reason: "neutral" };
  return { decision: "HOLD", reason: "review" };
}
