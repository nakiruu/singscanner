// Mock scan generator for UI development before market data is wired.
// Signal family scores are synthetic (random 0..100) but they are fed through
// the real forecast/roles/gate/star pipeline so the UI sees realistic shapes.

import { parseHorizon, calibrate } from "./horizon";
import { forecast, applyMlBoost } from "./forecast";
import { computeConfidence } from "./confidence";
import { assignRoles } from "./roles";
import { gateDecision } from "./gate";
import { computeStopTarget, starScore } from "./levels";
import type { ScanRow, ScanSnapshot, Role } from "./types";

const UNIVERSE = [
  "NVDA","AMD","TSLA","AAPL","MSFT","META","AMZN","GOOGL","AVGO","CRWD",
  "PLTR","COIN","SHOP","UBER","NFLX","SNOW","ARM","SMCI","MU","ASML",
];

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 0xffffffff);
  };
}

// Maps a role to its calibrated edge band and friction multiplier.
function roleParams(
  role: Role,
  calib: ReturnType<typeof calibrate>,
): { roleEdge: number; friction: number } {
  switch (role) {
    case "primary":   return { roleEdge: calib.edgePrimary,   friction: calib.frictionPrimary };
    case "secondary": return { roleEdge: calib.edgeSecondary, friction: calib.frictionSecondary };
    case "retained":  return { roleEdge: calib.edgeRetained,  friction: calib.frictionRetained };
    case "none":      return { roleEdge: 0,                   friction: calib.frictionFloor };
  }
}

export function buildMockSnapshot(horizonSpec = "3d"): ScanSnapshot {
  const horizonMin = parseHorizon(horizonSpec);
  const calib = calibrate(horizonMin);
  // Bucketed seed so successive same-second hits return the same snapshot.
  const seed = Math.floor(Date.now() / 30_000);
  const rand = rng(seed);

  // First pass: build the per-symbol forecast and remember everything we need
  // to call gate/levels afterwards (we can't gate until we know each row's role,
  // and roles need every row's modelEdge to pick the primary cohort).
  interface Stage1 {
    symbol: string;
    price: number;
    spreadBps: number;
    relVol: number;
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
    quoteAgeSec: number;
    notional: number;
    barDollarVol: number;
    volPctPerBar: number;
    gapDays: number;
    isHeld: boolean;
  }

  const stage1: Stage1[] = UNIVERSE.map((symbol) => {
    const momentum  = Math.round(rand() * 100);
    const quality   = Math.round(rand() * 100);
    const liquidity = Math.round(rand() * 100);
    const risk      = Math.round(rand() * 100);
    const signals = { momentum, quality, liquidity, risk };

    const volAnn = 0.25 + rand() * 0.45;
    const spreadBps = Number((2 + rand() * 14).toFixed(1));
    const familySpread = Math.max(momentum, quality, liquidity, risk)
                       - Math.min(momentum, quality, liquidity, risk);

    const confBase = computeConfidence({
      source: "mock",
      quoteAgeSec: rand() * 30,
      marketOpen: true,
      hasFundamentals: rand() > 0.2,
      spreadBps,
      missingFieldCount: Math.floor(rand() * 3),
      familySpread,
      horizonMin,
    });

    const f = forecast({ signals, confidence: confBase, volAnn, edgeHorizonMin: horizonMin, calib });

    const mlScore = rand() > 0.5 ? Math.round(rand() * 100) : null;
    const boosted = applyMlBoost({ confidence: confBase, evidence: f.evidence }, mlScore, null);

    return {
      symbol,
      price: Number((50 + rand() * 400).toFixed(2)),
      spreadBps,
      relVol: Number((0.5 + rand() * 2).toFixed(2)),
      momentum, quality, liquidity, risk,
      composite: f.composite,
      pUp: f.pUp,
      confidence: Math.min(boosted.confidence, 1.0),
      mu: f.mu,
      evidence: boosted.evidence,
      mlScore,
      volAnn,
      quoteAgeSec: rand() * 30,
      notional: 10_000 + rand() * 40_000,
      barDollarVol: 2_000_000 + rand() * 20_000_000,
      volPctPerBar: 0.002 + rand() * 0.015,
      gapDays: 1 + Math.floor(rand() * 2),
      isHeld: false,
    };
  });

  // First, pre-compute modelEdge ASSUMING primary friction so we can rank evenly.
  // This is what assignRoles needs to find the primary band. We then re-derive
  // role-specific friction inside gateDecision.
  const provisionalEdges = stage1.map((s) => calib.edgePrimary * calib.frictionPrimary);
  const assignments = assignRoles(
    stage1.map((s, i) => ({
      evidence: s.evidence,
      pUp: s.pUp,
      modelEdge: provisionalEdges[i],
      isHeld: s.isHeld,
    })),
    calib,
  );

  // Second pass: gate + stop/target per row.
  const rows: ScanRow[] = stage1.map((s, i) => {
    const role = assignments[i].role;
    const { roleEdge, friction } = roleParams(role, calib);
    const isMember = s.evidence >= calib.evidenceThreshold && s.pUp >= calib.memberPupMin;

    const g = gateDecision({
      role,
      roleEdge,
      friction,
      spreadBps: s.spreadBps,
      volPctPerBar: s.volPctPerBar,
      notional: s.notional,
      barDollarVol: s.barDollarVol,
      quoteAgeSec: s.quoteAgeSec,
      gapDays: s.gapDays,
      sessionMult: calib.sessionRegular,
      exitReserve: calib.exitReserve,
      opRisk: calib.opRisk,
      cashWait: calib.cashWait,
      minHurdle: calib.minHurdle,
      isHeld: s.isHeld,
      isMember,
    });

    return {
      symbol: s.symbol,
      price: s.price,
      spreadBps: s.spreadBps,
      relVol: s.relVol,
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
      source: "mock",
    };
  });

  // Stars: top 5 BUYs by starScore.
  const holdingDays = Math.max(1, horizonMin / 390);
  const buyScored = rows
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
      const score = starScore({
        netSurplus: r.net,
        confidence: r.confidence,
        risk: r.risk,
        targetUpPct,
      });
      return { row: r, score };
    })
    .filter((x): x is { row: ScanRow; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);

  buyScored.slice(0, 5).forEach((x) => (x.row.star = true));

  return {
    generatedAt: new Date().toISOString(),
    horizon: horizonSpec,
    universe: "mock",
    symbolsScanned: rows.length,
    rows: rows.sort((a, b) => Number(b.star) - Number(a.star) || b.net - a.net),
  };
}
