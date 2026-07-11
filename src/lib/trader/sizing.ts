// Risk-based position sizing, ported from auto3 trader.py size_position()
// (lines 492-521) with one deliberate change: WHOLE SHARES ONLY (spec v1) —
// raw < 1 returns 0 instead of a fractional qty.

export interface TraderSettings {
  riskPerTrade: number;        // fraction of equity risked if stop hits
  maxPositionPct: number;      // notional cap per position
  cashFloorPct: number;        // reserve kept out of rotation budgets
  minConviction: number;
  maxConviction: number;
  maxPositions: number;
  maxEntriesPerCycle: number;
  maxRotationsPerCycle: number;
  rotationMinAgeS: number;
  reversalCooldownS: number;
}

export interface SizeInputs {
  equity: number;
  buyingPower: number;
  price: number;
  stop: number;
  conviction: number;          // in [minConviction, maxConviction]
  cashAvailable?: number;      // override for rotation flow
  settings: TraderSettings;
}

// Whole-share qty, floored. 0 means "do not enter".
export function sizePosition(i: SizeInputs): number {
  const riskPerShare = i.price - i.stop;
  if (riskPerShare <= 0 || i.price <= 0 || i.equity <= 0) return 0;
  const riskBudget = i.equity * i.settings.riskPerTrade * i.conviction;
  const riskQty = riskBudget / riskPerShare;
  const notionalQty = (i.equity * i.settings.maxPositionPct) / i.price;
  const cash = i.cashAvailable ?? i.buyingPower;
  const cashQty = cash > 0 ? cash / i.price : 0;
  const raw = Math.min(riskQty, notionalQty, cashQty);
  return raw >= 1 ? Math.floor(raw) : 0;
}

// Spec §4: candidates ranked by net desc get conviction linearly from
// maxConviction (rank 1) down to minConviction (rank N). Single candidate
// gets maxConviction. rank is 1-based.
export function convictionForRank(rank: number, n: number, s: TraderSettings): number {
  if (n <= 1) return s.maxConviction;
  return s.maxConviction - ((rank - 1) * (s.maxConviction - s.minConviction)) / (n - 1);
}
