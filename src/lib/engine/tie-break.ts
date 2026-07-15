// Shared tie-breaker functions for deterministic ordering.
//
// Near cross-sectional cutoffs (primaryBand, rotation hurdles) ties are
// common and breaking them by upstream iteration order is arbitrary —
// Paleologo (2021, Advanced Portfolio Management) argues for explicit
// secondary criteria to avoid "the same input producing different books
// on different processes."
//
// Comparators are stable and total on the fields they touch. Compose via
// composeComparators when multiple criteria stack.

export type Comparator<T> = (a: T, b: T) => number;

// Descending by numeric field; NaN sorts last.
export function byNumberDesc<T>(get: (x: T) => number): Comparator<T> {
  return (a, b) => {
    const av = get(a);
    const bv = get(b);
    const aValid = Number.isFinite(av);
    const bValid = Number.isFinite(bv);
    if (!aValid && !bValid) return 0;
    if (!aValid) return 1;
    if (!bValid) return -1;
    return bv - av;
  };
}

// Ascending by numeric field.
export function byNumberAsc<T>(get: (x: T) => number): Comparator<T> {
  return (a, b) => -byNumberDesc(get)(a, b);
}

// Ascending lexicographic on a string field.
export function byStringAsc<T>(get: (x: T) => string): Comparator<T> {
  return (a, b) => get(a).localeCompare(get(b));
}

// Chain comparators — first non-zero result wins. Standard secondary-sort
// pattern; used to gate "liquidity desc, then symbol asc" style ordering.
export function composeComparators<T>(...cmps: Comparator<T>[]): Comparator<T> {
  return (a, b) => {
    for (const cmp of cmps) {
      const c = cmp(a, b);
      if (c !== 0) return c;
    }
    return 0;
  };
}

// Common presets used by assignRoles + scoreRotations tie-breaks.
export interface HasSymbol { symbol: string }
export interface HasLiquidity { liquidity: number }
export interface HasNetBps { netBps: number }

export function byLiquidityDesc<T extends HasLiquidity>(): Comparator<T> {
  return byNumberDesc((x) => x.liquidity);
}
export function byNetBpsDesc<T extends HasNetBps>(): Comparator<T> {
  return byNumberDesc((x) => x.netBps);
}
export function bySymbolAsc<T extends HasSymbol>(): Comparator<T> {
  return byStringAsc((x) => x.symbol);
}
