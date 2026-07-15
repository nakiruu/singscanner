// Historical backlog runner. Replays past N trading days of scans against
// daily-bar-derivable inputs; forward-prices via bars N days later.
// Idempotent — checks countResolvedHistorical() before running.

import { fetchDailyBars, computeBarFeatures } from "@/lib/data/bars";
import { fetchActiveUniverse } from "@/lib/data/universe";
import { assertPointInTimeAvailable } from "@/lib/data/universe-pit";
import { calibrate, parseHorizon } from "@/lib/engine/horizon";
import { computeFamilies, type RawSymbolInputs } from "@/lib/engine/signals";
import { forecast } from "@/lib/engine/forecast";
import { assignRoles } from "@/lib/engine/roles";
import { gateDecision } from "@/lib/engine/gate";
import type { ScanRow, Role } from "@/lib/engine/types";
import {
  countResolvedHistorical,
  insertResolved,
  newId,
} from "./persistence";
import { extractFeatures, sessionBucketNow, bucketKey } from "./features";
import type { ShadowMonitor } from "./monitor";
import { HORIZON_RESOLUTION_MS } from "./monitor";

const HISTORICAL_LOOKBACK_DAYS = Number(process.env.SHADOW_HISTORICAL_LOOKBACK_DAYS ?? "200");
const MIN_HISTORY_DAYS = Number(process.env.SHADOW_MIN_HISTORY_DAYS ?? "100");
const NET_DIVERGENCE_BPS = 20;

// Fail-loud guard: prevent silent survivorship contamination when an operator
// sets HISTORICAL_LOOKBACK_DAYS past the safe-without-PIT threshold. See
// src/lib/data/universe-pit.ts module header for the rationale.
assertPointInTimeAvailable(HISTORICAL_LOOKBACK_DAYS);

export interface BacklogProgress {
  horizon: string;
  daysProcessed: number;
  daysTotal: number;
  samplesAdded: number;
  running: boolean;
  error: string | null;
}

// Anchored on globalThis: instrumentation and route-handler bundles each get
// their own module instance, but must share backlog progress state.
const globalBacklog = globalThis as unknown as {
  __shadowBacklogProgress?: Map<string, BacklogProgress>;
};
const progressByHorizon: Map<string, BacklogProgress> =
  (globalBacklog.__shadowBacklogProgress ??= new Map());

export function getBacklogProgress(horizon: "3d" | "5d" | "10d"): BacklogProgress {
  return (
    progressByHorizon.get(horizon) ?? {
      horizon,
      daysProcessed: 0,
      daysTotal: 0,
      samplesAdded: 0,
      running: false,
      error: null,
    }
  );
}

export async function runHistoricalBacklog(
  monitor: ShadowMonitor,
  opts: { force?: boolean } = {},
): Promise<void> {
  const horizon = monitor.horizonKey;
  const key = horizon;
  const existing = await countResolvedHistorical(horizon);
  if (existing > 0 && !opts.force) {
    console.log(`[shadow] ${horizon} backlog skipped (${existing} historical rows exist)`);
    return;
  }
  console.log(`[shadow] ${horizon} backlog starting (lookback ${HISTORICAL_LOOKBACK_DAYS}d)`);

  const progress: BacklogProgress = {
    horizon,
    daysProcessed: 0,
    daysTotal: HISTORICAL_LOOKBACK_DAYS,
    samplesAdded: 0,
    running: true,
    error: null,
  };
  progressByHorizon.set(key, progress);

  try {
    const universeEntries = await fetchActiveUniverse(600);
    if (universeEntries.length === 0) throw new Error("empty universe");

    const symbols = universeEntries.map((u) => u.symbol);
    // Fat window: 260 trading days back from today + 20 forward for horizon lookup.
    const dailyMap = await fetchDailyBars(symbols, 260 + Math.ceil(HISTORICAL_LOOKBACK_DAYS));
    const spyMap = await fetchDailyBars(["SPY"], 260);
    const spy = spyMap.get("SPY") ?? null;

    if ((spy?.length ?? 0) < MIN_HISTORY_DAYS) {
      throw new Error(`insufficient bar coverage (spy=${spy?.length ?? 0})`);
    }

    const horizonMin = parseHorizon(horizon);
    const calib = calibrate(horizonMin);
    const challenger = monitor.getChallenger();

    // Iterate day indices from oldest to newest within the lookback window.
    const spyLen = spy!.length;
    const startIdx = Math.max(0, spyLen - HISTORICAL_LOOKBACK_DAYS - 15);
    const endIdx = Math.max(0, spyLen - 15); // Leave 15d for forward lookup.
    progress.daysTotal = Math.max(0, endIdx - startIdx);

    for (let dayIdx = startIdx; dayIdx < endIdx; dayIdx++) {
      const D = spy![dayIdx].t;
      const rows = buildRowsForDay(symbols, dailyMap, spy!, dayIdx, calib, horizonMin);
      const sessionForDay = "regular" as const;
      const cashFraction = 0.5;

      for (const row of rows) {
        const features = extractFeatures(row, { cashFraction, tickerEdge: 0 });
        const bucket = bucketKey(row.role, sessionForDay);
        const { estimate: chalEdge } = challenger.predict(bucket, features, row.modelEdge);
        const chalNet = row.net + (chalEdge - row.modelEdge);
        const chalDecision = deriveDecision(row, chalNet);

        // Forward price = close at dayIdx + horizonDays.
        const horizonTradingDays = Math.round(HORIZON_RESOLUTION_MS[horizon] / (6.5 * 60 * 60 * 1000));
        const forwardIdx = dayIdx + horizonTradingDays;
        const symBars = dailyMap.get(row.symbol);
        if (!symBars || forwardIdx >= symBars.length) continue;
        const forwardPrice = symBars[forwardIdx].c;
        if (!forwardPrice || row.price <= 0) continue;

        const realizedBps = (forwardPrice / row.price - 1) * 10000;
        const baselineValueBps = valueOf(row.decision, realizedBps);
        const challengerValueBps = valueOf(chalDecision, realizedBps);
        const deltaBps = challengerValueBps - baselineValueBps;

        // Train on EVERY resolved row, not just divergent ones. A fresh
        // challenger predicts exactly the baseline fallback, so gating
        // updates on divergence would deadlock cold start: never diverges →
        // never learns → 0 samples forever.
        challenger.update(bucket, features, challengerValueBps);

        const netDiverges = Math.abs(chalNet - row.net) > NET_DIVERGENCE_BPS;
        if (row.decision === chalDecision && !netDiverges) continue;

        await insertResolved({
          id: newId(),
          horizon,
          symbol: row.symbol,
          submittedAt: D,
          resolvedAt: new Date().toISOString(),
          baselineDecision: row.decision,
          challengerDecision: chalDecision,
          realizedBps,
          baselineValueBps,
          challengerValueBps,
          deltaBps,
          source: "historical",
          clean: 1,
        });
        progress.samplesAdded += 1;
      }
      progress.daysProcessed += 1;

      if (progress.daysProcessed % 20 === 0) {
        await challenger.flushNow();
      }
    }
    await challenger.flushNow();
    progress.running = false;
    console.log(
      `[shadow] ${horizon} backlog complete: ${progress.samplesAdded} samples over ${progress.daysProcessed} days`,
    );
  } catch (err) {
    progress.error = (err as Error).message;
    progress.running = false;
    console.warn(`[shadow] ${horizon} backlog failed:`, err);
  }
}

// -- helpers ----------------------------------------------------------------

function buildRowsForDay(
  symbols: string[],
  dailyMap: Map<string, import("@/lib/data/bars").DailyBar[]>,
  spy: import("@/lib/data/bars").DailyBar[],
  dayIdx: number,
  calib: ReturnType<typeof calibrate>,
  horizonMin: number,
): ScanRow[] {
  const rawInputs: RawSymbolInputs[] = [];
  const packs: Array<{
    symbol: string;
    price: number;
    features: import("@/lib/data/bars").BarFeatures;
  }> = [];
  for (const sym of symbols) {
    const bars = dailyMap.get(sym);
    if (!bars || dayIdx >= bars.length) continue;
    const window = bars.slice(Math.max(0, dayIdx - 260), dayIdx + 1);
    if (window.length < 30) continue;
    const spyWindow = spy.slice(Math.max(0, dayIdx - 260), dayIdx + 1);
    const feats = computeBarFeatures(window, spyWindow, null);
    const price = window[window.length - 1].c;
    if (!price || price <= 0) continue;
    packs.push({ symbol: sym, price, features: feats });
    rawInputs.push({
      ret_3d: feats.ret_3d,
      ret_5d: feats.ret_5d,
      ret_10d: feats.ret_10d,
      retPrev5d: feats.ret_prev_5d,
      ret_21d: feats.ret_21d ?? 0,
      ret_63d: feats.ret_63d ?? 0,
      ret_126d: feats.ret_126d ?? 0,
      trend_slope: feats.trend_slope ?? 0,
      priceOverSma50: feats.sma50 && feats.sma50 > 0 ? price / feats.sma50 : 1,
      priceOverHigh60d: feats.high_60d && feats.high_60d > 0 ? price / feats.high_60d : 0.95,
      retPrev21d: feats.ret_prev_21d ?? 0,
      dayVol: price * 0,
      avg20dVol: feats.avg_dollar_vol_20d ?? 1_000_000,
      revGrowth: null,
      earnGrowth: null,
      profitMargin: null,
      roe: null,
      debtToEquity: null,
      fwdPE: null,
      spreadBps: 8,
      barDollarVol: 1_000_000,
      relVol: 1,
      realizedVol: feats.realized_vol_ann ?? 0.3,
      beta: feats.beta_vs_spy ?? 1,
      maxDD60d: feats.max_drawdown_60d ?? 0,
    });
  }
  if (packs.length === 0) return [];
  const families = computeFamilies(rawInputs);
  const stage1 = packs.map((p, i) => {
    const signals = families[i];
    const f = forecast({
      signals,
      confidence: 1,
      volAnn: p.features.realized_vol_ann ?? 0.3,
      edgeHorizonMin: horizonMin,
      calib,
    });
    return { pack: p, signals, pUp: f.pUp, mu: f.mu, composite: f.composite, evidence: f.evidence };
  });

  const pUpScale = (pUp: number) => Math.max(0, 2 * pUp - 1);
  const provisional = stage1.map((s) => calib.edgePrimary * calib.frictionPrimary * pUpScale(s.pUp));
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
    const role: Role = assignments[i].role;
    const baseRoleEdge =
      role === "primary" ? calib.edgePrimary :
      role === "secondary" ? calib.edgeSecondary :
      role === "retained" ? calib.edgeRetained : 0;
    const friction =
      role === "primary" ? calib.frictionPrimary :
      role === "secondary" ? calib.frictionSecondary :
      role === "retained" ? calib.frictionRetained : calib.frictionFloor;
    const roleEdge = baseRoleEdge * pUpScale(s.pUp);
    const isMember = s.evidence >= calib.evidenceThreshold && s.pUp >= calib.memberPupMin;
    const g = gateDecision({
      role,
      roleEdge,
      friction,
      frictionFloor: calib.frictionFloor,
      frictionCeiling: calib.frictionCeiling,
      spreadBps: 8,
      volPctPerBar: 0.012,
      notional: 10_000,
      barDollarVol: 1_000_000,
      quoteAgeSec: 0,
      gapDays: 1,
      sessionMultEntry: calib.sessionRegular,
      sessionMultExit: calib.sessionRegular,
      exitReserve: calib.exitReserve,
      opRisk: calib.opRisk,
      cashWait: calib.cashWait,
      minHurdle: calib.minHurdle,
      isHeld: false,
      isMember,
    });
    return {
      symbol: s.pack.symbol,
      price: s.pack.price,
      decision: g.decision,
      role,
      net: g.net,
      modelEdge: g.modelEdge,
      confidence: 1,
      momentum: s.signals.momentum,
      quality: s.signals.quality,
      liquidity: s.signals.liquidity,
      risk: s.signals.risk,
      composite: s.composite,
      pUp: s.pUp,
      mu: s.mu,
      evidence: s.evidence,
      reason: g.decision,
      // Fields we don't use for backlog computation but must satisfy the type:
      volAnn: s.pack.features.realized_vol_ann ?? 0.3,
      spreadBps: 8,
      cEntry: g.cEntry,
      cExit: g.cExit,
      cQueue: g.cQueue,
      cMemory: g.cMemory,
      concentrationBps: 0,
      star: false,
      starScore: null,
      source: "alpaca",
      exchange: "NASDAQ",
      targetWeight: 0,
      horizonLadder: [],
      crossesWeekend: false,
      gapDays: 1,
      stopPx: 0,
      stopLimitPx: 0,
      fairValueTargetPx: 0,
      takeProfitLimitPx: 0,
      confidenceFactors: {
        source: 1,
        staleQuote: 1,
        missingFundamentals: 1,
        wideSpread: 1,
        missingFields: 1,
        familyDisagreement: 1,
      },
    } as unknown as ScanRow;
  });
  return out;
}

function deriveDecision(row: ScanRow, chalNet: number): string {
  if (row.role === "none") return "HOLD-CASH";
  if (chalNet > 0) return "BUY";
  return "WAIT";
}

function valueOf(decision: string, realizedBps: number): number {
  return decision === "BUY" ? realizedBps : -realizedBps;
}

// Keep sessionBucketNow referenced so the import survives the lint pass.
void sessionBucketNow;
