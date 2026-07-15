// Role-distribution SRM canary.
//
// Companion to shadow/srm.ts (which watches baseline-vs-challenger row
// counts). This module watches the CROSS-SECTIONAL role band split from
// scanner output — primary / secondary / retained / none — and alerts
// when the observed distribution drifts materially from its historical
// baseline.
//
// A sudden collapse of "primary" (e.g. because edgePrimary drifted or
// the universe compressed) means downstream sizing has nothing to work
// with. A sudden inflation of "primary" (e.g. adaptive primaryBand
// went too wide) means the star cutoff no longer discriminates. Either
// is worth surfacing before it degrades trading behavior.
//
// Pure in-memory rolling. No CH dependency.

const HISTORY_SIZE = 100;   // scans retained
const ALARM_P = 0.001;
const MIN_SCAN_ROWS = 30;

export type RoleCounts = {
  primary: number;
  secondary: number;
  retained: number;
  none: number;
};

interface RoleSample {
  horizon: string;
  counts: RoleCounts;
  ts: number;
}

const history = new Map<string, RoleSample[]>();

function keyOf(horizon: string): string { return horizon; }

// Called once per snapshot. Cheap.
export function recordRoleCounts(horizon: string, counts: RoleCounts): void {
  const total = counts.primary + counts.secondary + counts.retained + counts.none;
  if (total < MIN_SCAN_ROWS) return;
  const buf = history.get(keyOf(horizon)) ?? [];
  buf.push({ horizon, counts, ts: Date.now() });
  if (buf.length > HISTORY_SIZE) buf.shift();
  history.set(keyOf(horizon), buf);
}

export interface RoleSrmResult {
  horizon: string;
  n: number;
  latest: RoleCounts;
  baseline: RoleCounts;    // mean proportions over history (excluding latest)
  chi2: number;
  pValue: number;
  alarm: boolean;
}

// Chi-square goodness-of-fit for the latest role counts vs the mean-of-
// baseline proportions across history. dof = 3 (4 categories - 1).
export function roleSrmCheck(horizon: string): RoleSrmResult | null {
  const buf = history.get(keyOf(horizon)) ?? [];
  if (buf.length < 10) return null;

  const latest = buf[buf.length - 1];
  const prior = buf.slice(0, -1);

  // Mean proportions across prior samples.
  let pPrimary = 0, pSecondary = 0, pRetained = 0, pNone = 0;
  for (const s of prior) {
    const tot = s.counts.primary + s.counts.secondary + s.counts.retained + s.counts.none;
    if (tot === 0) continue;
    pPrimary   += s.counts.primary   / tot;
    pSecondary += s.counts.secondary / tot;
    pRetained  += s.counts.retained  / tot;
    pNone      += s.counts.none      / tot;
  }
  const nPrior = prior.length;
  pPrimary /= nPrior;
  pSecondary /= nPrior;
  pRetained /= nPrior;
  pNone /= nPrior;

  const totalLatest =
    latest.counts.primary + latest.counts.secondary + latest.counts.retained + latest.counts.none;
  const expected = {
    primary: pPrimary * totalLatest,
    secondary: pSecondary * totalLatest,
    retained: pRetained * totalLatest,
    none: pNone * totalLatest,
  };

  // Guard: don't fire when any expected cell is < 5 (chi-square breaks down).
  if (
    expected.primary < 5 || expected.secondary < 5
    || expected.retained < 5 || expected.none < 5
  ) return null;

  const chi2 =
    ((latest.counts.primary   - expected.primary)   ** 2) / expected.primary
    + ((latest.counts.secondary - expected.secondary) ** 2) / expected.secondary
    + ((latest.counts.retained  - expected.retained)  ** 2) / expected.retained
    + ((latest.counts.none      - expected.none)      ** 2) / expected.none;

  const pValue = chi2SurvivalThreeDoF(chi2);

  const baseline: RoleCounts = {
    primary: Math.round(expected.primary),
    secondary: Math.round(expected.secondary),
    retained: Math.round(expected.retained),
    none: Math.round(expected.none),
  };

  return {
    horizon,
    n: totalLatest,
    latest: latest.counts,
    baseline,
    chi2,
    pValue,
    alarm: pValue < ALARM_P,
  };
}

// -- Helpers -----------------------------------------------------------------

// χ²(3) survival — closed-form via the lower incomplete gamma is
// non-trivial in TS. Use a series approximation adequate for the
// tail-alarm regime (p<0.001 → x > ~16). For 3 DoF specifically:
//   P(X² > x) = (1 + x/2) · exp(-x/2)
// which is exact for χ²(3).
function chi2SurvivalThreeDoF(x: number): number {
  if (x <= 0) return 1;
  return (1 + x / 2) * Math.exp(-x / 2);
}
