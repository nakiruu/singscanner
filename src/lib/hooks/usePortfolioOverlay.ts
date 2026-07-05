"use client";

import { useMemo } from "react";
import { calibrate, parseHorizon } from "@/lib/engine/horizon";
import { computeStopTarget } from "@/lib/engine/levels";
import { sellDecision } from "@/lib/engine/sell";
import { scoreRotations, type RotationHolding, type RotationTarget } from "@/lib/engine/rotation";
import type { ScanRow, ScanSnapshot } from "@/lib/engine/types";
import type { PortfolioEntry, PortfolioOverlayRow } from "@/lib/portfolio/types";

const DEFAULT_HORIZON = "5d";

// Fallback vol used only when the row's `volAnn` is missing (should not happen
// in the live pipeline — scanner emits realized_vol_ann per row).
const VOL_ANN_FALLBACK = 0.3;

// How many rotation candidates to score per held position. The UI decides how
// many to render; the engine returns them ranked.
const ROTATION_SLATE_SIZE = 8;

export function usePortfolioOverlay(
  snapshot: ScanSnapshot | null,
  positions: PortfolioEntry[],
): PortfolioOverlayRow[] {
  return useMemo(() => {
    const horizonSpec = process.env.NEXT_PUBLIC_SCANNER_HORIZON ?? DEFAULT_HORIZON;
    const horizonMin = parseHorizon(horizonSpec);
    const calib = calibrate(horizonMin);
    const holdingDays = Math.max(1, horizonMin / 390);

    const rowBySymbol = new Map<string, ScanRow>();
    if (snapshot) {
      for (const r of snapshot.rows) rowBySymbol.set(r.symbol, r);
    }

    // Spec §30: build a rotation target slate from the current top BUYs. Use
    // scan `cost` as the proxy for the target's entry cost bps.
    const heldSymbols = new Set(positions.map((p) => p.symbol));
    const rotationTargets: RotationTarget[] = snapshot
      ? snapshot.rows
          .filter((r) => r.decision === "BUY" && !heldSymbols.has(r.symbol))
          .slice(0, ROTATION_SLATE_SIZE)
          .map((r) => ({
            symbol: r.symbol,
            role: r.role,
            netBps: r.net,
            entryCostBps: r.cost,
          }))
      : [];

    return positions.map((p): PortfolioOverlayRow => {
      const scanRow = rowBySymbol.get(p.symbol) ?? null;
      const currentPrice = scanRow?.price ?? null;
      const pnlDollars =
        currentPrice != null ? p.qty * (currentPrice - p.costBasis) : 0;
      const pnlPercent =
        currentPrice != null && p.costBasis > 0
          ? (currentPrice - p.costBasis) / p.costBasis
          : 0;

      if (!scanRow || currentPrice == null) {
        return {
          symbol: p.symbol,
          qty: p.qty,
          costBasis: p.costBasis,
          currentPrice: null,
          scanRow: null,
          pnlDollars,
          pnlPercent,
          stop: 0,
          target: 0,
          rr: 0,
          fairValueTarget: 0,
          takeProfitLimit: 0,
          stopLimit: 0,
          trailingStop: 0,
          trailingStopLimit: 0,
          minRRTarget: 0,
          minRRActive: false,
          decision: "HOLD",
          reason: "No scan data",
          rotationCandidates: [],
        };
      }

      const volAnn = scanRow.volAnn > 0 ? scanRow.volAnn : VOL_ANN_FALLBACK;

      const levels = computeStopTarget({
        ref: p.costBasis,
        volAnn,
        holdingDays,
        composite: scanRow.composite,
        confidence: scanRow.confidence,
        currentPrice,
        spreadBps: scanRow.spreadBps,
        calib,
      });

      // Spec §30: score rotations for this held name. The held row's expected
      // exit friction is proxied as 0.65·cost (SPECLIST §59 BUY exit scale
      // used for symmetry with entry cost budgeting).
      const holdingRotationInput: RotationHolding = {
        symbol: p.symbol,
        role: scanRow.role,
        netBps: Math.max(0, scanRow.net),
        modelEdgeBps: scanRow.modelEdge,
        exitCostBps: scanRow.cost * 0.65,
      };
      const rotationCandidates = scoreRotations(holdingRotationInput, rotationTargets, {
        topN: 3,
      });
      const bestRotation = rotationCandidates.length > 0 ? rotationCandidates[0] : null;

      const sell = sellDecision({
        price: currentPrice,
        stop: levels.stop,
        target: levels.target,
        composite: scanRow.composite,
        isMember: scanRow.role === "primary" || scanRow.role === "secondary",
        isRetained: scanRow.role === "retained",
        holdNetBps: scanRow.net,
        exitCostBps: scanRow.cost * 0.65,
        cashHurdleBps: calib.cashWait,
        bestRotation,
      });

      return {
        symbol: p.symbol,
        qty: p.qty,
        costBasis: p.costBasis,
        currentPrice,
        scanRow,
        pnlDollars,
        pnlPercent,
        // Legacy
        stop: levels.stop,
        target: levels.target,
        rr: levels.rr,
        // Spec-aligned split
        fairValueTarget: levels.fairValueTarget,
        takeProfitLimit: levels.takeProfitLimit,
        stopLimit: levels.stopLimit,
        trailingStop: levels.trailingStop,
        trailingStopLimit: levels.trailingStopLimit,
        minRRTarget: levels.minRRTarget,
        minRRActive: levels.minRRActive,
        decision: sell.decision,
        reason: sell.reason,
        rotateTo: sell.rotateTo,
        bestRotationBps: bestRotation?.cleared ? bestRotation.netAdvantageBps : 0,
        rotationCandidates,
      };
    });
  }, [snapshot, positions]);
}
