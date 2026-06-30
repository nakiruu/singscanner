// Shared scan singleton. One loop, many consumers (REST + SSE).
//
// Data source resolution:
//   - SCANNER_MOCK=true  -> always mock
//   - ALPACA_API_KEY set -> alpaca snapshots; fall back to mock on error
//   - otherwise          -> mock
//
// Signal families (M/Q/L/R 0-100) are still synthetic because we don't pull
// historical bars or fundamentals yet. The cost gate, however, uses REAL
// Alpaca quote + spread + volume + gap when available.

import { parseHorizon, calibrate } from "./horizon";
import { forecast, applyMlBoost } from "./forecast";
import { computeConfidence } from "./confidence";
import { assignRoles } from "./roles";
import { gateDecision } from "./gate";
import { computeStopTarget, starScore } from "./levels";
import type { ScanRow, ScanSnapshot, Role } from "./types";
import { fetchSnapshots, type AlpacaSnapshot } from "@/lib/data/alpaca";
import { predictXgb, type XgbInput } from "@/lib/ml/xgboost-client";
import { buildMockSnapshot } from "./mock";

const DEFAULT_UNIVERSE = [
  "NVDA","AMD","TSLA","AAPL","MSFT","META","AMZN","GOOGL","AVGO","CRWD",
  "PLTR","COIN","SHOP","UBER","NFLX","SNOW","ARM","SMCI","MU","ASML",
];

const REFRESH_MS = Math.max(5_000, Number(process.env.SCANNER_INTERVAL_S ?? "0") * 1000 || 15_000);

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

// Synthetic-but-stable per-symbol jitter so two consecutive scans don't whiplash.
function symbolHash(symbol: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) | 0;
  return ((h >>> 0) / 0xffffffff);
}

// Build the XGBoost feature vector for one symbol from whatever we have.
// Returns ALL feature keys (some null) so the sidecar's order-canonical mapping works.
// TODO: populate ret_*, sma*, vol/beta/dd, fundamentals once history-bar + fundamentals
// fetchers exist. Until then, only spread_bps and rel_volume are real — the sidecar
// will skip rows missing ret_21d/ret_63d and return mlScore=null.
function buildXgbFeatures(s: AlpacaSnapshot): XgbInput {
  return {
    symbol: s.symbol,
    features: {
      ret_21d: null,
      ret_63d: null,
      ret_126d: null,
      ret_prev_21d: null,
      accel: null,
      trend_slope: null,
      dist_sma50: null,
      dist_sma200: null,
      breakout: null,
      realized_vol_ann: null,
      beta: null,
      max_drawdown_60d: null,
      rel_volume: s.relVol ?? null,
      spread_bps: s.spreadBps ?? null,
      revenue_growth: null,
      earnings_growth: null,
      profit_margin: null,
      roe: null,
      debt_to_equity: null,
      forward_pe: null,
    },
  };
}

// Produce a ScanSnapshot from real Alpaca snapshots + synthetic M/Q/L/R.
async function snapshotFromAlpaca(rows: AlpacaSnapshot[], horizonSpec: string): Promise<ScanSnapshot> {
  const horizonMin = parseHorizon(horizonSpec);
  const calib = calibrate(horizonMin);
  const bucket = Math.floor(Date.now() / 30_000);

  // Batch ml inference up front so each symbol's stage1 row gets its real mlScore.
  // Fails open: if the sidecar is down or features are too thin, mlScore is null.
  const xgbResp = await predictXgb(rows.map(buildXgbFeatures));
  const mlScoreBySymbol = new Map<string, number>();
  for (const r of xgbResp.rows) mlScoreBySymbol.set(r.symbol, r.ml_score);

  interface Stage1 {
    src: AlpacaSnapshot;
    momentum: number;
    quality: number;
    liquidity: number;
    risk: number;
    composite: number;
    pUp: number;
    confidence: number;
    mu: number;
    evidence: number;
    mlScore: number | null;
    volAnn: number;
  }

  const stage1: Stage1[] = rows.map((s) => {
    // TODO: replace with real signal families once history bars + fundamentals land.
    const j = (offset: number) => Math.round(symbolHash(s.symbol, bucket + offset) * 100);
    const momentum = j(1);
    const quality = j(2);
    const liquidity = Math.max(0, Math.min(100, Math.round(100 - s.spreadBps * 2 + (s.relVol - 1) * 25)));
    const risk = j(4);

    const familySpread = Math.max(momentum, quality, liquidity, risk) - Math.min(momentum, quality, liquidity, risk);
    const confBase = computeConfidence({
      source: "alpaca",
      quoteAgeSec: s.quoteAgeSec,
      marketOpen: true,
      hasFundamentals: false,
      spreadBps: s.spreadBps,
      missingFieldCount: 0,
      familySpread,
      horizonMin,
    });

    const volAnn = 0.3; // TODO: from realized vol once bar history lands.
    const f = forecast({
      signals: { momentum, quality, liquidity, risk },
      confidence: confBase,
      volAnn,
      edgeHorizonMin: horizonMin,
      calib,
    });
    const mlScore = mlScoreBySymbol.get(s.symbol) ?? null;
    const boosted = applyMlBoost(
      { confidence: confBase, evidence: f.evidence },
      mlScore,
      null, // kronosPUp — wired in a later phase
      f.pUp,
    );

    return {
      src: s,
      momentum, quality, liquidity, risk,
      composite: f.composite,
      pUp: f.pUp,
      confidence: Math.min(boosted.confidence, 1),
      mu: f.mu,
      evidence: boosted.evidence,
      mlScore,
      volAnn,
    };
  });

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

  const out: ScanRow[] = stage1.map((s, i) => {
    const role = assignments[i].role;
    const { roleEdge, friction } = roleParams(role, calib);
    const isMember = s.evidence >= calib.evidenceThreshold && s.pUp >= calib.memberPupMin;

    const g = gateDecision({
      role,
      roleEdge,
      friction,
      frictionFloor: calib.frictionFloor,
      frictionCeiling: calib.frictionCeiling,
      spreadBps: s.src.spreadBps,
      volPctPerBar: null,           // need intraday bars; treat as missing → C_liq floor 35.
      notional: 10_000,             // TODO: per-user sizing.
      barDollarVol: s.src.dailyVolume * s.src.price,
      quoteAgeSec: s.src.quoteAgeSec,
      gapDays: s.src.gapDays,
      sessionMult: calib.sessionRegular,
      exitReserve: calib.exitReserve,
      opRisk: calib.opRisk,
      cashWait: calib.cashWait,
      minHurdle: calib.minHurdle,
      isHeld: false,
      isMember,
    });

    return {
      symbol: s.src.symbol,
      price: s.src.price,
      spreadBps: s.src.spreadBps,
      relVol: s.src.relVol,
      momentum: s.momentum,
      quality: s.quality,
      liquidity: s.liquidity,
      risk: s.risk,
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
      source: "alpaca",
    };
  });

  // Stars
  const holdingDays = Math.max(1, horizonMin / 390);
  const scored = out
    .map((r, i) => {
      if (r.decision !== "BUY" || !assignments[i].starEligible) return null;
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
      return { row: r, score: starScore({ netSurplus: r.net, confidence: r.confidence, risk: r.risk, targetUpPct }) };
    })
    .filter((x): x is { row: ScanRow; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);
  scored.slice(0, 5).forEach((x) => (x.row.star = true));

  return {
    generatedAt: new Date().toISOString(),
    horizon: horizonSpec,
    universe: "alpaca-default",
    symbolsScanned: out.length,
    rows: out.sort((a, b) => Number(b.star) - Number(a.star) || b.net - a.net),
  };
}

async function refresh(): Promise<ScanSnapshot> {
  const horizon = process.env.SCANNER_HORIZON ?? "5d";

  if (!useAlpaca()) return buildMockSnapshot(horizon);

  try {
    const universe = DEFAULT_UNIVERSE; // TODO: SCANNER_UNIVERSE=auto -> dynamic list
    const snapshots = await fetchSnapshots(universe);
    if (snapshots.length === 0) {
      console.warn("[scanner] alpaca returned no snapshots, falling back to mock");
      return buildMockSnapshot(horizon);
    }
    return await snapshotFromAlpaca(snapshots, horizon);
  } catch (err) {
    console.warn("[scanner] alpaca failed, falling back to mock:", err);
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
