// Sell triggers for held positions.
// Source: docs/instructions2.md "Sell triggers (held)".
// Priority order is significant: first matching rule wins.

import type { Decision } from "./types";

export interface SellInput {
  price: number;
  stop: number;
  target: number;
  composite: number;     // 0..100
  isMember: boolean;     // currently a long-side member
  isRetained: boolean;   // role == "retained"
}

export interface SellResult {
  decision: Decision;    // "SELL" or "HOLD"
  reason: string;        // short tag for UI / logging
}

export function sellDecision(s: SellInput): SellResult {
  // Hard rules first.
  if (s.price <= s.stop)   return { decision: "SELL", reason: "stop" };
  if (s.price >= s.target) return { decision: "SELL", reason: "take-profit" };

  // Soft rules: signal-based exits.
  if (s.composite < 38) return { decision: "SELL", reason: "reversal" };
  if (s.composite < 45 && !s.isMember && !s.isRetained) {
    return { decision: "SELL", reason: "deteriorated" };
  }

  // Holds with tagged reason — the UI cares about *why* we're holding.
  if (s.isMember)        return { decision: "HOLD", reason: "strong" };
  if (s.isRetained)      return { decision: "HOLD", reason: "retained" };
  if (s.composite >= 48) return { decision: "HOLD", reason: "neutral" };
  return { decision: "HOLD", reason: "review" };
}
