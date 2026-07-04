// Freshness decay. Spec §36:
//   effective = w · raw + (1-w) · prior     where w = exp(-age / halflife)
// For most trading signals, the prior is neutral (0 for edges, 50 for percentile
// scores). Callers pass raw, age, and a horizon-scaled halflife.

export interface FreshnessInput {
  ageSec: number;
  halflifeSec: number;
}

// Fraction of the raw signal that survives given its age.
export function freshnessWeight({ ageSec, halflifeSec }: FreshnessInput): number {
  if (halflifeSec <= 0) return 1;
  if (ageSec <= 0) return 1;
  return Math.exp(-ageSec / halflifeSec);
}

// Shrink a value toward a neutral prior by freshness weight.
//   decayToward(raw, prior, age, halflife)
export function decayToward(
  raw: number,
  prior: number,
  ageSec: number,
  halflifeSec: number,
): number {
  const w = freshnessWeight({ ageSec, halflifeSec });
  return w * raw + (1 - w) * prior;
}

// Horizon-scaled halflife anchors used across the engine.
// Spec §7: intraday signals decay fast; multi-day signals decay slow.
// At 5d horizon we want quote-age halflife ~ hours, not seconds.
export function quoteHalflifeSec(horizonMin: number): number {
  // 15-min horizon → 10-min halflife; 5d horizon → 4h halflife.
  const anchorShort = 600;      // 10 min
  const anchorLong = 4 * 3600;  // 4 hr
  const tShort = 15;
  const tLong = 5 * 6.5 * 60;   // 5 trading days
  if (horizonMin <= tShort) return anchorShort;
  if (horizonMin >= tLong) return anchorLong;
  const frac = Math.log(horizonMin / tShort) / Math.log(tLong / tShort);
  return anchorShort + (anchorLong - anchorShort) * frac;
}

// For fundamentals (updated quarterly) at 5d horizon: halflife ~ 30 trading days.
// For a 15-min horizon, fundamentals barely matter, so short halflife.
export function fundamentalHalflifeSec(horizonMin: number): number {
  const anchorShort = 6.5 * 3600;      // 1 trading day
  const anchorLong = 30 * 6.5 * 3600;  // 30 trading days
  const tShort = 15;
  const tLong = 5 * 6.5 * 60;
  if (horizonMin <= tShort) return anchorShort;
  if (horizonMin >= tLong) return anchorLong;
  const frac = Math.log(horizonMin / tShort) / Math.log(tLong / tShort);
  return anchorShort + (anchorLong - anchorShort) * frac;
}
