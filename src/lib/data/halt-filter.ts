// Halt / outlier bar filter.
//
// Halted stocks, exchange-glitch prints, and post-corporate-action bars
// look like extreme moves to a downstream signal engine — a stock that
// prints -30% because it just did a 3-for-2 split will look like the
// mother of all momentum reversals unless we drop the bar. This module
// runs a set of cheap rules over a daily bar stream and returns the
// bars that survive.
//
// Rules (all optional, all overridable via HaltFilterOpts):
//
//   1. Absolute-return outlier: |return_t| > returnStdMult × rolling_std
//      Flags bars whose return is more than N σ from the trailing 20-day
//      rolling std of returns. Typical N=5 catches earnings-day gaps
//      that are 5σ+ but leaves single-digit-σ moves alone.
//
//   2. Volume-collapse: volume_t < collapseFraction × avg20d_volume
//      Flags bars where volume is < 5% of trailing average — usually a
//      halt or a bad tape print. Doesn't flag low-volume names in
//      absolute terms.
//
//   3. Zero-price / zero-volume: any bar with c ≤ 0 or v ≤ 0 (data
//      corruption).
//
// Pure module — takes DailyBar[] returns DailyBar[]. Callers wire this
// upstream of computeBarFeatures behind DATA_HALT_FILTER=on.

import type { DailyBar } from "./bars";

export interface HaltFilterOpts {
  returnStdMult?: number;      // default 5.0
  collapseFraction?: number;   // default 0.05
  windowDays?: number;         // rolling window for std/avg (default 20)
}

export interface HaltFilterResult {
  survived: DailyBar[];
  rejected: Array<{ bar: DailyBar; reason: string }>;
}

const DEFAULT_OPTS: Required<HaltFilterOpts> = {
  returnStdMult: 5.0,
  collapseFraction: 0.05,
  windowDays: 20,
};

// Apply the filter. Runs in a single pass; O(n · windowDays).
export function filterHaltsAndOutliers(
  bars: readonly DailyBar[],
  opts: HaltFilterOpts = {},
): HaltFilterResult {
  const o = { ...DEFAULT_OPTS, ...opts };
  const survived: DailyBar[] = [];
  const rejected: Array<{ bar: DailyBar; reason: string }> = [];

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];

    // Rule 3: data-integrity guards.
    if (b.c <= 0) {
      rejected.push({ bar: b, reason: "zero-or-negative-close" });
      continue;
    }
    if (b.v <= 0) {
      rejected.push({ bar: b, reason: "zero-or-negative-volume" });
      continue;
    }

    // Rules 1 + 2 need trailing history. Below the window size, accept
    // unconditionally — insufficient data to detect an outlier.
    if (i < o.windowDays) {
      survived.push(b);
      continue;
    }

    const window = bars.slice(i - o.windowDays, i);
    const returns: number[] = [];
    for (let j = 1; j < window.length; j++) {
      if (window[j - 1].c > 0) returns.push(window[j].c / window[j - 1].c - 1);
    }
    const prevC = bars[i - 1].c;
    if (prevC <= 0) {
      survived.push(b);
      continue;
    }
    const thisReturn = b.c / prevC - 1;

    // Rule 1: absolute-return outlier.
    if (returns.length >= 5) {
      const meanR = returns.reduce((s, x) => s + x, 0) / returns.length;
      const variance = returns.reduce((s, x) => s + (x - meanR) ** 2, 0) / returns.length;
      const std = Math.sqrt(Math.max(0, variance));
      if (std > 0 && Math.abs(thisReturn) > o.returnStdMult * std) {
        rejected.push({
          bar: b,
          reason: `return-outlier σ×${(Math.abs(thisReturn) / std).toFixed(1)}`,
        });
        continue;
      }
    }

    // Rule 2: volume-collapse.
    const volumes = window.map((w) => w.v).filter((v) => v > 0);
    if (volumes.length >= 5) {
      const avgVol = volumes.reduce((s, x) => s + x, 0) / volumes.length;
      if (avgVol > 0 && b.v < o.collapseFraction * avgVol) {
        rejected.push({
          bar: b,
          reason: `volume-collapse ${((b.v / avgVol) * 100).toFixed(1)}%`,
        });
        continue;
      }
    }

    survived.push(b);
  }

  return { survived, rejected };
}
