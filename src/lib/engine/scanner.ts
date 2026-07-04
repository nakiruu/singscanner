// Shared scan singleton. One loop, many consumers (REST + SSE).
//
// Data source resolution:
//   - SCANNER_MOCK=true  -> always mock
//   - ALPACA_API_KEY set -> real live pipeline
//   - otherwise          -> mock
//
// Live pipeline (Wave 2):
//   universe -> snapshots + daily bars + intraday bars + SPY bars + fundamentals
//     -> computeBarFeatures per symbol
//     -> computeFamilies (cross-sectional M/Q/L/R from real inputs)
//     -> XGBoost features built from BarFeatures + fundamentals
//     -> forecast / applyMlBoost / roles / gate / stars
//   marketOpen + session phase come from real Alpaca clock.

import { parseHorizon, calibrate } from "./horizon";
import { forecast, applyMlBoost } from "./forecast";
import { computeConfidence } from "./confidence";
import { assignRoles } from "./roles";
import { gateDecision } from "./gate";
import { computeStopTarget, starScore } from "./levels";
import { buildTargetPortfolio } from "./portfolio";
import {
  computeFamilies,
  hasFundamentals as familyHasFundamentals,
  type RawSymbolInputs,
} from "./signals";
import type { ScanRow, ScanSnapshot, Role } from "./types";
import { fetchSnapshots } from "@/lib/data/alpaca";
import {
  computeBarFeatures,
  fetchDailyBars,
  fetchIntradayBars,
  type BarFeatures,
  type DailyBar,
  type IntradayBar,
} from "@/lib/data/bars";
import { getClock, type ClockState, type MarketPhase } from "@/lib/data/clock";
import { fetchActiveUniverse, type UniverseEntry } from "@/lib/data/universe";
import { predictXgb, type XgbInput, type XgbFeatures } from "@/lib/ml/xgboost-client";
import { fetchFundamentals, type FundamentalRow } from "@/lib/ml/fundamentals-client";
import { buildMockSnapshot } from "./mock";

const REFRESH_MS = Math.max(5_000, Number(process.env.SCANNER_INTERVAL_S ?? "0") * 1000 || 15_000);
const MAX_SYMBOLS = Math.max(10, Number(process.env.SCANNER_MAX_SYMBOLS ?? "100"));

interface Cache {
  snapshot: ScanSnapshot | null;
  ts: number;
  inflight: Promise<ScanSnapshot> | null;
}

const cache: Cache = { snapshot: null, ts: 0, inflight: null };

function useAlpaca(): boolean {
  return process.env.SCANNER_MOCK !== "true" && !!process.env.ALPACA_API_KEY;
}

function roleParams(role: Role, calib: ReturnType<typeof calibrate>) {
  switch (role) {
    case "primary":   return { roleEdge: calib.edgePrimary,   friction: calib.frictionPrimary };
    case "secondary": return { roleEdge: calib.edgeSecondary, friction: calib.frictionSecondary };
    case "retained":  return { roleEdge: calib.edgeRetained,  friction: calib.frictionRetained };
    case "none":      return { roleEdge: 0,                   friction: calib.frictionFloor };
  }
}

// Map clock phase to the matching calibrated session multiplier.
function sessionMultFor(phase: MarketPhase, calib: ReturnType<typeof calibrate>): number {
  switch (phase) {
    case "regular":  return calib.sessionRegular;
    case "extended": return calib.sessionExtended;
    case "closed":   return calib.sessionClosed;
  }
}

// Build the canonical XGBoost feature vector from bar features + fundamentals.
// Missing values stay null; the sidecar treats them as NaN (XGBoost handles natively).
function buildXgbFeatures(
  symbol: string,
  price: number,
  feats: BarFeatures,
  fund: FundamentalRow | null,
  relVol: number,
  spreadBps: number,
): XgbInput {
  const accel =
    feats.ret_21d != null && feats.ret_prev_21d != null
      ? feats.ret_21d - feats.ret_prev_21d
      : null;
  // ml2 short-term acceleration: ret_5d - ret_prev_5d
  const shortAccel =
    feats.ret_5d != null && feats.ret_prev_5d != null
      ? feats.ret_5d - feats.ret_prev_5d
      : null;
  const distSma50 = feats.sma50 && feats.sma50 > 0 ? price / feats.sma50 - 1 : null;
  const distSma200 = feats.sma200 && feats.sma200 > 0 ? price / feats.sma200 - 1 : null;
  const breakout = feats.high_60d && feats.high_60d > 0 ? price / feats.high_60d : null;

  const features: XgbFeatures = {
    // ml2 short-term lookbacks (must appear FIRST to match training order)
    ret_3d: feats.ret_3d,
    ret_5d: feats.ret_5d,
    ret_10d: feats.ret_10d,
    ret_21d: feats.ret_21d,
    ret_63d: feats.ret_63d,
    ret_126d: feats.ret_126d,
    ret_prev_21d: feats.ret_prev_21d,
    accel,
    short_accel: shortAccel,
    trend_slope: feats.trend_slope,
    dist_sma50: distSma50,
    dist_sma200: distSma200,
    breakout,
    realized_vol_ann: feats.realized_vol_ann,
    beta: feats.beta_vs_spy,
    max_drawdown_60d: feats.max_drawdown_60d,
    rel_volume: relVol,
    spread_bps: spreadBps,
    revenue_growth: fund?.revenue_growth ?? null,
    earnings_growth: fund?.earnings_growth ?? null,
    profit_margin: fund?.profit_margin ?? null,
    roe: fund?.roe ?? null,
    debt_to_equity: fund?.debt_to_equity ?? null,
    forward_pe: fund?.forward_pe ?? null,
  };
  return { symbol, features };
}

interface SymbolPack {
  symbol: string;
  exchange: string;
  price: number;
  spreadBps: number;
  relVol: number;
  quoteAgeSec: number;
  gapDays: number;
  dailyVolume: number;
  feats: BarFeatures;
  fund: FundamentalRow | null;
}

// Build RawSymbolInputs from a SymbolPack. Conservative defaults for null
// features so the cross-sectional ranker has something to rank — using NaN
// would silently zero a row's percentile because of the sorted-array filter.
// Short-term lookbacks stay nullable: signals.ts rankOrNull skips missing parts.
function rawInputsFor(p: SymbolPack): RawSymbolInputs {
  const f = p.feats;
  const dollarVol = p.price * p.dailyVolume;
  const avg20dVol =
    f.avg_dollar_vol_20d != null && f.avg_dollar_vol_20d > 0 ? f.avg_dollar_vol_20d : dollarVol;
  const sma50ok = f.sma50 != null && f.sma50 > 0;
  const high60ok = f.high_60d != null && f.high_60d > 0;
  return {
    // short-term lookbacks (ml2)
    ret_3d:            f.ret_3d,
    ret_5d:            f.ret_5d,
    ret_10d:           f.ret_10d,
    retPrev5d:         f.ret_prev_5d,

    ret_21d:           f.ret_21d ?? 0,
    ret_63d:           f.ret_63d ?? 0,
    ret_126d:          f.ret_126d ?? 0,
    trend_slope:       f.trend_slope ?? 0,
    priceOverSma50:    sma50ok ? p.price / (f.sma50 as number) : 1,
    priceOverHigh60d:  high60ok ? p.price / (f.high_60d as number) : 0.95,
    retPrev21d:        f.ret_prev_21d ?? 0,
    dayVol:            dollarVol,
    avg20dVol,
    revGrowth:         p.fund?.revenue_growth ?? null,
    earnGrowth:        p.fund?.earnings_growth ?? null,
    profitMargin:      p.fund?.profit_margin ?? null,
    roe:               p.fund?.roe ?? null,
    debtToEquity:      p.fund?.debt_to_equity ?? null,
    fwdPE:             p.fund?.forward_pe ?? null,
    spreadBps:         p.spreadBps,
    barDollarVol:      dollarVol,
    relVol:            p.relVol,
    realizedVol:       f.realized_vol_ann ?? 0.3,
    beta:              f.beta_vs_spy ?? 1.0,
    maxDD60d:          f.max_drawdown_60d ?? 0,
  };
}

// Build the live snapshot from real Alpaca + fundamentals + clock.
async function buildLiveSnapshot(horizonSpec: string): Promise<ScanSnapshot> {
  const horizonMin = parseHorizon(horizonSpec);
  const calib = calibrate(horizonMin);

  // Stage 0: clock + universe in parallel (independent).
  const [clockState, universe] = await Promise.all([
    getClock(),
    fetchActiveUniverse(MAX_SYMBOLS),
  ]);

  if (universe.length === 0) {
    throw new Error("empty universe");
  }

  const symbols = universe.map((u) => u.symbol);
  const exchangeBySymbol = new Map<string, string>(
    universe.map((u) => [u.symbol, u.exchange]),
  );

  // Stage 1: quotes + bars + fundamentals + SPY (for beta). All parallel.
  const [snapshots, dailyMap, intradayMap, fundResp, spyDailyMap] = await Promise.all([
    fetchSnapshots(symbols),
    fetchDailyBars(symbols, 260),
    fetchIntradayBars(symbols, 240, "5Min"),
    fetchFundamentals(symbols),
    fetchDailyBars(["SPY"], 260),
  ]);

  const spyBars: DailyBar[] | null = spyDailyMap.get("SPY") ?? null;
  const fundBySymbol = new Map<string, FundamentalRow>(
    fundResp.rows.map((r) => [r.symbol, r]),
  );

  // Stage 2: assemble per-symbol packs, computing BarFeatures.
  // Drop symbols missing the bare-minimum history (ret_21d AND ret_63d) — the
  // cross-sectional families and the XGBoost model can't say anything useful.
  const packs: SymbolPack[] = [];
  for (const snap of snapshots) {
    const daily: DailyBar[] | undefined = dailyMap.get(snap.symbol);
    if (!daily) continue;
    const intraday: IntradayBar[] | null = intradayMap.get(snap.symbol) ?? null;
    const feats = computeBarFeatures(daily, spyBars, intraday);
    if (feats.ret_21d == null && feats.ret_63d == null) continue;
    packs.push({
      symbol: snap.symbol,
      exchange: exchangeBySymbol.get(snap.symbol) ?? "OTHER",
      price: snap.price,
      spreadBps: snap.spreadBps,
      relVol: snap.relVol,
      quoteAgeSec: snap.quoteAgeSec,
      gapDays: snap.gapDays,
      dailyVolume: snap.dailyVolume,
      feats,
      fund: fundBySymbol.get(snap.symbol) ?? null,
    });
  }

  if (packs.length === 0) {
    throw new Error("no symbols survived feature extraction");
  }

  // Stage 3: cross-sectional family ranking.
  const rawInputs: RawSymbolInputs[] = packs.map(rawInputsFor);
  const families = computeFamilies(rawInputs);

  // Stage 4: XGBoost batch predict.
  const xgbInputs: XgbInput[] = packs.map((p) =>
    buildXgbFeatures(p.symbol, p.price, p.feats, p.fund, p.relVol, p.spreadBps),
  );
  const xgbResp = await predictXgb(xgbInputs);
  const mlByS = new Map<string, number>();
  for (const r of xgbResp.rows) mlByS.set(r.symbol, r.ml_score);

  // Stage 5: per-symbol pipeline (confidence → forecast → ML boost).
  interface Stage1Row {
    pack: SymbolPack;
    signals: { momentum: number; quality: number; liquidity: number; risk: number };
    composite: number;
    pUp: number;
    confidence: number;
    mu: number;
    evidence: number;
    mlScore: number | null;
    volAnn: number;
  }

  const stage1: Stage1Row[] = packs.map((p, i) => {
    const signals = families[i];
    const familySpread =
      Math.max(signals.momentum, signals.quality, signals.liquidity, signals.risk) -
      Math.min(signals.momentum, signals.quality, signals.liquidity, signals.risk);
    const hasFund = familyHasFundamentals(rawInputs[i]);

    const missingFieldCount =
      [p.feats.ret_21d, p.feats.ret_63d, p.feats.ret_126d, p.feats.beta_vs_spy,
       p.feats.realized_vol_ann, p.feats.max_drawdown_60d].filter((x) => x == null).length;

    const confBase = computeConfidence({
      source: "alpaca",
      quoteAgeSec: p.quoteAgeSec,
      marketOpen: clockState.isOpen,
      hasFundamentals: hasFund,
      spreadBps: p.spreadBps,
      missingFieldCount,
      familySpread,
      horizonMin,
    });

    // Real annualized vol if we have it, else a sensible default.
    const volAnn = p.feats.realized_vol_ann ?? 0.3;

    const f = forecast({
      signals,
      confidence: confBase,
      volAnn,
      edgeHorizonMin: horizonMin,
      calib,
    });

    const mlScore = mlByS.get(p.symbol) ?? null;
    const boosted = applyMlBoost(
      { confidence: confBase, evidence: f.evidence },
      mlScore,
      null, // kronosPUp — Phase C
      f.pUp,
    );

    return {
      pack: p,
      signals,
      composite: f.composite,
      pUp: f.pUp,
      confidence: Math.min(boosted.confidence, 1),
      mu: f.mu,
      evidence: boosted.evidence,
      mlScore,
      volAnn,
    };
  });

  // Stage 6: roles. Use provisional edge = primary friction so every row is
  // ranked on the same scale before bands are picked; per-row friction comes
  // out of gateDecision after the assignment.
  const provisional = stage1.map(() => calib.edgePrimary * calib.frictionPrimary);
  const assignments = assignRoles(
    stage1.map((s, i) => ({
      evidence: s.evidence,
      pUp: s.pUp,
      modelEdge: provisional[i],
      isHeld: false,
    })),
    calib,
  );

  // Stage 7: gate per row using REAL session, vol-per-bar, dollar volume, gap.
  const sessionMult = sessionMultFor(clockState.phase, calib);

  // Pass 1: gate each row WITHOUT concentration (we need net edges to build the
  // target portfolio, then concentration bps come out of that).
  const pass1 = stage1.map((s, i) => {
    const role = assignments[i].role;
    const { roleEdge, friction } = roleParams(role, calib);
    const isMember = s.evidence >= calib.evidenceThreshold && s.pUp >= calib.memberPupMin;
    const p = s.pack;

    const g = gateDecision({
      role,
      roleEdge,
      friction,
      frictionFloor: calib.frictionFloor,
      frictionCeiling: calib.frictionCeiling,
      spreadBps: p.spreadBps,
      volPctPerBar: p.feats.vol_pct_per_bar,
      notional: 10_000,                              // TODO: per-user sizing
      barDollarVol: p.price * p.dailyVolume,
      quoteAgeSec: p.quoteAgeSec,
      gapDays: p.gapDays,
      sessionMult,
      exitReserve: calib.exitReserve,
      opRisk: calib.opRisk,
      cashWait: calib.cashWait,
      minHurdle: calib.minHurdle,
      isHeld: false,
      isMember,
    });

    return { role, roleEdge, isMember, g };
  });

  // Spec §57: build target portfolio via source-conviction. Only positive-net
  // qualifying rows contribute; the rest fall to cash.
  const portfolio = buildTargetPortfolio(
    pass1.map((r, i) => ({
      symbol: stage1[i].pack.symbol,
      role: r.role,
      roleEdgeBps: r.roleEdge,
      netBps: r.g.net,
      confidence: stage1[i].confidence,
      isHeld: false,
    })),
    { gamma: calib.gamma },
  );
  const concByS = new Map<string, number>();
  const weightByS = new Map<string, number>();
  for (const w of portfolio.weights) {
    concByS.set(w.symbol, w.concentrationBps);
    weightByS.set(w.symbol, w.targetWeight);
  }

  // Pass 2: re-gate with concentration bps so decisions reflect the whole book.
  const out: ScanRow[] = stage1.map((s, i) => {
    const { role, roleEdge, friction } = { ...pass1[i], friction: roleParams(pass1[i].role, calib).friction };
    const isMember = pass1[i].isMember;
    const p = s.pack;
    const concentrationBps = concByS.get(p.symbol) ?? 0;
    const targetWeight = weightByS.get(p.symbol) ?? 0;

    const g = gateDecision({
      role,
      roleEdge,
      friction,
      frictionFloor: calib.frictionFloor,
      frictionCeiling: calib.frictionCeiling,
      spreadBps: p.spreadBps,
      volPctPerBar: p.feats.vol_pct_per_bar,
      notional: 10_000,
      barDollarVol: p.price * p.dailyVolume,
      quoteAgeSec: p.quoteAgeSec,
      gapDays: p.gapDays,
      sessionMult,
      exitReserve: calib.exitReserve,
      opRisk: calib.opRisk,
      cashWait: calib.cashWait,
      minHurdle: calib.minHurdle,
      isHeld: false,
      isMember,
      concentrationBps,
    });

    return {
      symbol: p.symbol,
      price: p.price,
      spreadBps: p.spreadBps,
      relVol: p.relVol,
      momentum: s.signals.momentum,
      quality: s.signals.quality,
      liquidity: s.signals.liquidity,
      risk: s.signals.risk,
      composite: s.composite,
      pUp: s.pUp,
      confidence: s.confidence,
      mu: s.mu,
      evidence: s.evidence,
      mlScore: s.mlScore,
      role,
      decision: g.decision,
      modelEdge: g.modelEdge,
      cost: g.required,
      net: g.net,
      star: false,
      starScore: null,
      source: "alpaca",
      exchange: p.exchange,
      targetWeight,
      concentrationBps,
    };
  });

  // Stage 8: starScore for all BUY rows; top 5 starEligible BUYs get star=true.
  const holdingDays = Math.max(1, horizonMin / 390);
  out.forEach((r, i) => {
    if (r.decision !== "BUY") return;
    const st = computeStopTarget({
      ref: r.price,
      volAnn: stage1[i].volAnn,
      holdingDays,
      composite: r.composite,
      confidence: r.confidence,
      currentPrice: r.price,
      calib,
    });
    const targetUpPct = ((st.target - r.price) / r.price) * 100;
    r.starScore = starScore({ netSurplus: r.net, confidence: r.confidence, risk: r.risk, targetUpPct });
  });
  const scored = out
    .filter((r, i) => r.decision === "BUY" && assignments[i].starEligible && r.starScore != null)
    .sort((a, b) => (b.starScore ?? 0) - (a.starScore ?? 0));
  scored.slice(0, 5).forEach((r) => (r.star = true));

  return {
    generatedAt: new Date().toISOString(),
    horizon: horizonSpec,
    universe: clockState.isOpen ? "alpaca-live" : `alpaca-${clockState.phase}`,
    symbolsScanned: out.length,
    rows: out.sort((a, b) => Number(b.star) - Number(a.star) || b.net - a.net),
    cashWeight: portfolio.cashWeight,
  };
}

// Silence unused-var warnings for types only referenced for clarity.
void ([] as ClockState[]);
void ([] as UniverseEntry[]);

async function refresh(): Promise<ScanSnapshot> {
  const horizon = process.env.SCANNER_HORIZON ?? "5d";

  if (!useAlpaca()) return buildMockSnapshot(horizon);

  try {
    return await buildLiveSnapshot(horizon);
  } catch (err) {
    console.warn("[scanner] live pipeline failed, falling back to mock:", err);
    return buildMockSnapshot(horizon);
  }
}

export async function getLatestSnapshot(): Promise<ScanSnapshot> {
  const fresh = Date.now() - cache.ts < REFRESH_MS;
  if (cache.snapshot && fresh) return cache.snapshot;
  if (cache.inflight) return cache.inflight;

  cache.inflight = refresh().then((snap) => {
    cache.snapshot = snap;
    cache.ts = Date.now();
    cache.inflight = null;
    return snap;
  }).catch((err) => {
    cache.inflight = null;
    throw err;
  });
  return cache.inflight;
}

export function getCachedSnapshot(): ScanSnapshot | null {
  return cache.snapshot;
}
