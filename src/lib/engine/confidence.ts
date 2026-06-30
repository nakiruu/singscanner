// Horizon-adaptive confidence multiplier in [0.05, 1.0].
// Source: docs/instructions2.md "Confidence (horizon-adaptive, t same as calibration)".

import { clamp, lerp } from "./stats";
import { horizonT } from "./horizon";

export interface ConfidenceInput {
  source: string;             // "alpaca" | "yf" | "mock" | "unknown" | ...
  quoteAgeSec: number;        // seconds since last quote
  marketOpen: boolean;        // stale penalty only fires during regular session
  hasFundamentals: boolean;
  spreadBps: number;
  missingFieldCount: number;  // # of nullable/optional inputs that came back missing
  familySpread: number;       // max(M,Q,L,R) - min(M,Q,L,R)
  horizonMin: number;
}

// Source whitelist treated as "known". Everything else takes the unknown-source penalty.
const KNOWN_SOURCES = new Set(["alpaca", "yf", "polygon", "iex"]);

export function computeConfidence(inp: ConfidenceInput): number {
  const t = horizonT(inp.horizonMin);
  let q = 1.0;

  // --- Unknown source ---
  if (!KNOWN_SOURCES.has(inp.source)) {
    q *= lerp(t, 0.70, 0.90);
  }

  // --- Stale quote (only when market is open) ---
  // For short horizons we punish small staleness hard; for long horizons we don't care much.
  if (inp.marketOpen) {
    const thresh = lerp(t, 8, 600);
    const ramp   = lerp(t, 60, 7200);
    const floor  = lerp(t, 0.40, 0.85);
    if (inp.quoteAgeSec > thresh) {
      q *= clamp(1 - (inp.quoteAgeSec - thresh) / ramp, floor, 1);
    }
  }

  // --- No fundamentals ---
  if (!inp.hasFundamentals) {
    q *= lerp(t, 0.92, 0.55);
  }

  // --- Wide spread ---
  const sThresh = lerp(t, 15, 200);
  const sRamp   = lerp(t, 100, 800);
  const sFloor  = lerp(t, 0.40, 0.75);
  if (inp.spreadBps > sThresh) {
    q *= clamp(1 - (inp.spreadBps - sThresh) / sRamp, sFloor, 1);
  }

  // --- Per missing field, modest haircut ---
  if (inp.missingFieldCount > 0) {
    q *= clamp(1 - 0.04 * inp.missingFieldCount, 0.6, 1);
  }

  // --- Family disagreement: only kicks in past 40-pt spread ---
  if (inp.familySpread > 40) {
    q *= clamp(1 - (inp.familySpread - 40) / 200, 0.7, 1);
  }

  return clamp(q, 0.05, 1.0);
}
