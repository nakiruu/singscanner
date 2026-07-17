// Signal families: Momentum / Quality / Liquidity / Risk, each 0..100,
// cross-sectionally percentile-ranked over the universe.
// Source: docs/instructions2.md "Signal families".

import { clamp, mean, percentileRank } from "./stats";
import type { SignalScores } from "./forecast";
import { percentileBand, clip } from "./winsorize";

// Cross-sectional signal winsorization at 1%/99%. Prevents a handful of
// extreme raw values (earnings gaps, restatements, micro-denominator ratios)
// from compressing the middle of the distribution during percentile ranking.
// Green, Hand & Zhang (2017 RFS) treat this as step 2 of the canonical
// 5-step signal pipeline. Applied inside sortedFinite* so every family
// consumes clipped universes automatically.
const SIGNAL_WINSORIZE_ENABLED = process.env.SIGNAL_WINSORIZE === "on";
const SIGNAL_WINSORIZE_LO_PCT = 1;
const SIGNAL_WINSORIZE_HI_PCT = 99;
const SIGNAL_WINSORIZE_MIN_N = 20;

// C7-1: enable Amihud ILLIQ as a 4th Liquidity-family component.
// Requires RawSymbolInputs.amihud to be populated upstream (bars.ts /
// scanner.ts). Legacy 3-component Liquidity family stays intact by default.
const AMIHUD_ENABLED = process.env.SIGNAL_LIQUIDITY_FAMILY_AMIHUD === "on";

// In-place tail clip on an already-sorted array. Preserves sort order
// because the tails collapse to boundary values (many repeated ends).
function applyTailClip(sorted: number[]): void {
  if (!SIGNAL_WINSORIZE_ENABLED || sorted.length < SIGNAL_WINSORIZE_MIN_N) return;
  const { lo, hi } = percentileBand(sorted, SIGNAL_WINSORIZE_LO_PCT, SIGNAL_WINSORIZE_HI_PCT);
  for (let i = 0; i < sorted.length; i++) {
    sorted[i] = clip(sorted[i], lo, hi);
  }
}

// Raw per-symbol inputs the families consume.
// Fundamentals are nullable: we treat null as "missing" everywhere.
export interface RawSymbolInputs {
  // Momentum block — short-term lookbacks (ml2/engine.py:415-419) are critical
  // for 5–10d horizons. All nullable because shorter windows aren't always
  // available; computeFamilies skips a part when its input is null.
  ret_3d: number | null;
  ret_5d: number | null;
  ret_10d: number | null;
  retPrev5d: number | null;     // 5d window before the last (short_accel input)

  ret_21d: number;
  ret_63d: number;
  ret_126d: number;
  trend_slope: number;          // e.g. slope of log price regression
  priceOverSma50: number;       // price / SMA50  (we subtract 1 below)
  priceOverHigh60d: number;     // price / 60d high
  retPrev21d: number;           // prior 21d return (so ret21d - retPrev21d = accel)
  dayVol: number;               // today's $ volume (or share vol)
  avg20dVol: number;            // 20d avg of the same series

  // Quality (fundamentals, nullable)
  revGrowth: number | null;
  earnGrowth: number | null;
  profitMargin: number | null;
  roe: number | null;
  debtToEquity: number | null;  // lower = better; we invert via 100-pctile
  fwdPE: number | null;         // lower = better; we invert via 100-pctile
  // Optional GICS sector code (e.g., "Energy", "Financials"). Set when the
  // upstream data feed (FMP sidecar) supplies it. Reserves the interface
  // slot for future D3-4 industry-neutralization (Cohen & Polk WP) —
  // subtract industry medians from Quality inputs before percentile
  // ranking. No consumer today.
  sector?: string | null;

  // Liquidity
  spreadBps: number;
  barDollarVol: number;
  relVol: number;               // today's vol / typical vol (>0)
  // C7-1: optional Amihud ILLIQ = mean(|return_t| / dollar_volume_t) over
  // trailing 20 days. Computed upstream (bars.ts) from the same window
  // used for realized vol. Small values = liquid, large = illiquid.
  // Consumed as a 4th Liquidity-family component when
  // SIGNAL_LIQUIDITY_FAMILY_AMIHUD=on. Null/undefined = component skipped.
  amihud?: number | null;

  // Risk (higher composite = SAFER)
  realizedVol: number;          // any consistent realized-vol metric
  beta: number;
  maxDD60d: number;             // signed, e.g. -0.18 for -18% drawdown
}

interface MomentumExtras {
  accel: number;
  shortAccel: number | null;     // ret_5d - retPrev5d (ml2/engine.py:398-399)
  volRatio: number;
}

interface PreparedMomentum {
  raw: RawSymbolInputs;
  extras: MomentumExtras;
}

// Build a sorted array (ascending) from a number iterable, skipping non-finite.
// Optionally winsorizes tails at 1%/99% when SIGNAL_WINSORIZE=on.
function sortedFiniteAsc(xs: Iterable<number>): number[] {
  const arr: number[] = [];
  for (const x of xs) if (Number.isFinite(x)) arr.push(x);
  arr.sort((a, b) => a - b);
  applyTailClip(arr);
  return arr;
}

// Same, for nullable numbers — nulls dropped.
function sortedFiniteAscNullable(xs: Iterable<number | null>): number[] {
  const arr: number[] = [];
  for (const x of xs) if (x != null && Number.isFinite(x)) arr.push(x);
  arr.sort((a, b) => a - b);
  applyTailClip(arr);
  return arr;
}

// Percentile of a value vs a sorted array, or null if value is missing/NaN.
function rankOrNull(value: number | null, sorted: number[]): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return percentileRank(value, sorted);
}

// Fundamentals threshold: a symbol has "fundamentals" if at least 2 of the 6
// fundamental fields are non-null. Below that we return a neutral 50.
function countFundamentals(r: RawSymbolInputs): number {
  let c = 0;
  if (r.revGrowth     != null) c++;
  if (r.earnGrowth    != null) c++;
  if (r.profitMargin  != null) c++;
  if (r.roe           != null) c++;
  if (r.debtToEquity  != null) c++;
  if (r.fwdPE         != null) c++;
  return c;
}

export function hasFundamentals(r: RawSymbolInputs): boolean {
  return countFundamentals(r) >= 2;
}

// Average of only the defined pctiles; if everything is missing, return 50 (neutral).
function meanDefined(xs: Array<number | null>): number {
  const defined: number[] = [];
  for (const x of xs) if (x != null && Number.isFinite(x)) defined.push(x);
  if (defined.length === 0) return 50;
  return mean(defined);
}

// Build the M/Q/L/R 0..100 family scores for every row in `rows`.
// Returns an array aligned by index with the input.
export function computeFamilies(rows: readonly RawSymbolInputs[]): SignalScores[] {
  const n = rows.length;
  if (n === 0) return [];

  // --- Momentum: precompute the derived series first.
  const prepared: PreparedMomentum[] = rows.map((r) => ({
    raw: r,
    extras: {
      accel: r.ret_21d - r.retPrev21d,
      shortAccel:
        r.ret_5d !== null && r.retPrev5d !== null
          ? r.ret_5d - r.retPrev5d
          : null,
      // relative day volume; guard /0
      volRatio: r.avg20dVol > 0 ? r.dayVol / r.avg20dVol : 1,
    },
  }));

  // momentum sorted universes
  // short-term — ml2/engine.py:361-363
  const s_ret3     = sortedFiniteAscNullable(prepared.map((p) => p.raw.ret_3d));
  const s_ret5     = sortedFiniteAscNullable(prepared.map((p) => p.raw.ret_5d));
  const s_ret10    = sortedFiniteAscNullable(prepared.map((p) => p.raw.ret_10d));
  // medium / long
  const s_ret21    = sortedFiniteAsc(prepared.map((p) => p.raw.ret_21d));
  const s_ret63    = sortedFiniteAsc(prepared.map((p) => p.raw.ret_63d));
  const s_ret126   = sortedFiniteAsc(prepared.map((p) => p.raw.ret_126d));
  const s_slope    = sortedFiniteAsc(prepared.map((p) => p.raw.trend_slope));
  const s_pSma50   = sortedFiniteAsc(prepared.map((p) => p.raw.priceOverSma50 - 1));
  const s_pHigh60  = sortedFiniteAsc(prepared.map((p) => p.raw.priceOverHigh60d));
  const s_accel    = sortedFiniteAsc(prepared.map((p) => p.extras.accel));
  const s_shortAcc = sortedFiniteAscNullable(prepared.map((p) => p.extras.shortAccel));
  const s_volRatio = sortedFiniteAsc(prepared.map((p) => p.extras.volRatio));

  // quality sorted universes (skip nulls)
  const s_revG    = sortedFiniteAscNullable(rows.map((r) => r.revGrowth));
  const s_earnG   = sortedFiniteAscNullable(rows.map((r) => r.earnGrowth));
  const s_margin  = sortedFiniteAscNullable(rows.map((r) => r.profitMargin));
  const s_roe     = sortedFiniteAscNullable(rows.map((r) => r.roe));
  const s_de      = sortedFiniteAscNullable(rows.map((r) => r.debtToEquity));
  const s_fwdPE   = sortedFiniteAscNullable(rows.map((r) => r.fwdPE));

  // liquidity sorted universes
  const s_dollarVol = sortedFiniteAsc(rows.map((r) => r.barDollarVol));
  // C7-1: Amihud rank universe. Ordered ASCENDING (small = liquid) so we
  // invert via `100 - percentileRank` when scoring — higher family score
  // = MORE liquid, consistent with the tightSpread / dollarVolPct axes.
  const s_amihud = AMIHUD_ENABLED
    ? sortedFiniteAscNullable(rows.map((r) => r.amihud ?? null))
    : [];

  // risk sorted universes
  const s_realVol = sortedFiniteAsc(rows.map((r) => r.realizedVol));
  const s_beta    = sortedFiniteAsc(rows.map((r) => Math.abs(r.beta)));

  return prepared.map((p) => {
    const r = p.raw;

    // ---- Momentum: mean of percentile ranks (Python ml2 ranks ONLY non-null
    // parts; we mirror that with rankOrNull + meanDefined).
    // ml2/engine.py:404-441
    const momentumParts: Array<number | null> = [
      // short-term lookbacks (most relevant for 5–10d horizons)
      rankOrNull(r.ret_3d,                   s_ret3),
      rankOrNull(r.ret_5d,                   s_ret5),
      rankOrNull(r.ret_10d,                  s_ret10),
      // medium / long-term lookbacks
      percentileRank(r.ret_21d,              s_ret21),
      percentileRank(r.ret_63d,              s_ret63),
      percentileRank(r.ret_126d,             s_ret126),
      // trend / breakout
      percentileRank(r.trend_slope,          s_slope),
      percentileRank(r.priceOverSma50 - 1,   s_pSma50),
      percentileRank(r.priceOverHigh60d,     s_pHigh60),
      // acceleration (medium + short)
      percentileRank(p.extras.accel,         s_accel),
      rankOrNull(p.extras.shortAccel,        s_shortAcc),
      // volume confirmation
      percentileRank(p.extras.volRatio,      s_volRatio),
    ];
    const momentum = meanDefined(momentumParts);

    // ---- Quality: average of whatever fundamental parts exist; 50 if none.
    // Python engine.py score_symbol (~lines 426-444): `q_parts` are appended only
    // when the field is non-null; `quality = fmean(q_parts) if q_parts else 50.0`.
    // `has_fundamentals` is a SEPARATE flag (len(q_parts) >= 2) used only by
    // confidence — it does NOT gate the quality score itself.
    // Note: Python additionally guards forward_pe with `> 0`; we mirror that.
    const qParts: Array<number | null> = [
      rankOrNull(r.revGrowth,    s_revG),
      rankOrNull(r.earnGrowth,   s_earnG),
      rankOrNull(r.profitMargin, s_margin),
      rankOrNull(r.roe,          s_roe),
      // debtToEquity and fwdPE: invert because lower is better
      r.debtToEquity != null ? 100 - percentileRank(r.debtToEquity, s_de) : null,
      r.fwdPE != null && r.fwdPE > 0 ? 100 - percentileRank(r.fwdPE, s_fwdPE) : null,
    ];
    const quality = meanDefined(qParts);

    // ---- Liquidity ----
    // 100-spreadBps clamped 0..100 (so spread in bps interpreted as a "tightness" pctile)
    const tightSpread = clamp(100 - r.spreadBps, 0, 100);
    const dollarVolPct = percentileRank(r.barDollarVol, s_dollarVol);
    // relVol on a log scale: 1.0 -> 50, 10x -> 75, 0.1x -> 25; clamp 0..100
    // log10(relVol) guarded for non-positive input
    const safeRelVol = r.relVol > 0 ? r.relVol : 1e-6;
    const relVolScore = clamp(50 + 25 * Math.log10(safeRelVol), 0, 100);
    // C7-1: Amihud ILLIQ rank inverted so higher = more liquid; averaged in
    // only when both the flag is on AND a value was provided upstream.
    const amihudScore =
      AMIHUD_ENABLED && r.amihud != null && Number.isFinite(r.amihud)
        ? 100 - percentileRank(r.amihud, s_amihud)
        : null;
    const liqParts = amihudScore != null
      ? [tightSpread, dollarVolPct, relVolScore, amihudScore]
      : [tightSpread, dollarVolPct, relVolScore];
    const liquidity = mean(liqParts);

    // ---- Risk (higher = safer) ----
    const safeVol  = 100 - percentileRank(r.realizedVol, s_realVol);
    const safeBeta = 100 - percentileRank(Math.abs(r.beta), s_beta);
    // maxDD60d is signed (negative = worse); spec: clamp(100 + maxDD*200, 0, 100)
    const safeDD   = clamp(100 + r.maxDD60d * 200, 0, 100);
    const risk = mean([safeVol, safeBeta, safeDD]);

    return { momentum, quality, liquidity, risk };
  });
}
