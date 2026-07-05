// Horizon-adaptive confidence multiplier in [0.05, 1.0].
// SPECLIST §8 (uncertainty is a cost), §36 (freshness decay).
//
// Every haircut is exposed as its own factor so the UI can explain WHY a row's
// confidence is low without users having to reverse-engineer the product.

import { clamp, lerp } from "./stats";
import { horizonT } from "./horizon";
import { freshnessWeight, quoteHalflifeSec } from "./freshness";

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

// Per-cause multiplicative factors in [floor, 1]. Product ≈ final value modulo
// the outer [0.05, 1.0] clamp. UI can render these as chips.
export interface ConfidenceFactors {
  source: number;
  staleQuote: number;
  missingFundamentals: number;
  wideSpread: number;
  missingFields: number;
  familyDisagreement: number;
}

export interface ConfidenceResult {
  value: number;              // 0.05..1.0 — final scalar used everywhere
  factors: ConfidenceFactors;
}

const KNOWN_SOURCES = new Set(["alpaca", "yf", "polygon", "iex"]);

// SPECLIST §36: effective = w · raw + (1-w) · prior, with w = exp(-age/halflife).
// For confidence, prior is "no confidence" (0), so the freshness weight itself
// IS the multiplier. A per-horizon floor prevents the multiplier from
// collapsing entirely for very stale quotes on long horizons.
function staleQuoteFactor(ageSec: number, marketOpen: boolean, horizonMin: number, t: number): number {
  if (!marketOpen) return 1;
  const grace = lerp(t, 8, 600);             // seconds tolerated before decay begins
  const floor = lerp(t, 0.40, 0.85);         // horizon-scaled hard floor
  if (ageSec <= grace) return 1;
  const halflife = quoteHalflifeSec(horizonMin);
  const w = freshnessWeight({ ageSec: ageSec - grace, halflifeSec: halflife });
  return Math.max(floor, w);
}

export function computeConfidence(inp: ConfidenceInput): ConfidenceResult {
  const t = horizonT(inp.horizonMin);

  // Unknown data source — cheap constant haircut.
  const source = KNOWN_SOURCES.has(inp.source) ? 1 : lerp(t, 0.70, 0.90);

  const staleQuote = staleQuoteFactor(inp.quoteAgeSec, inp.marketOpen, inp.horizonMin, t);

  // Fundamentals: matters more the longer the horizon (§4.2).
  const missingFundamentals = inp.hasFundamentals ? 1 : lerp(t, 0.92, 0.55);

  // Wide spread: linear ramp is fine here — spread is a spot property, not an
  // age. Keeps the shape simple and cheap.
  let wideSpread = 1;
  {
    const thresh = lerp(t, 15, 200);
    const ramp   = lerp(t, 100, 800);
    const floor  = lerp(t, 0.40, 0.75);
    if (inp.spreadBps > thresh) {
      wideSpread = clamp(1 - (inp.spreadBps - thresh) / ramp, floor, 1);
    }
  }

  // Per missing field, small haircut, capped at 0.6.
  const missingFields = inp.missingFieldCount > 0
    ? clamp(1 - 0.04 * inp.missingFieldCount, 0.6, 1)
    : 1;

  // Signal families disagreeing on the row is soft evidence of a noisy read.
  const familyDisagreement = inp.familySpread > 40
    ? clamp(1 - (inp.familySpread - 40) / 200, 0.7, 1)
    : 1;

  const value = clamp(
    source * staleQuote * missingFundamentals * wideSpread * missingFields * familyDisagreement,
    0.05,
    1.0,
  );

  return {
    value,
    factors: { source, staleQuote, missingFundamentals, wideSpread, missingFields, familyDisagreement },
  };
}
