"use client";

import { useMemo } from "react";
import { calibrate, parseHorizon } from "@/lib/engine/horizon";
import { computeStopTarget } from "@/lib/engine/levels";
import { sellDecision } from "@/lib/engine/sell";
import { scoreRotations, type RotationHolding, type RotationTarget } from "@/lib/engine/rotation";
import type { ScanRow, ScanSnapshot } from "@/lib/engine/types";
import type { PortfolioEntry, PortfolioOverlayRow } from "@/lib/portfolio/types";

// TODO: per-symbol annualized vol should come from the bars fetcher when it ships.
const ASSUMED_VOL_ANN = 0.3;
const DEFAULT_HORIZON = "5d";

// Number of BUY candidates considered as rotation destinations.
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
          decision: "HOLD",
          reason: "No scan data",
        };
      }

      const { stop, target, rr } = computeStopTarget({
        ref: p.costBasis,
        volAnn: ASSUMED_VOL_ANN,
        holdingDays,
        composite: scanRow.composite,
        confidence: scanRow.confidence,
        currentPrice,
        calib,
      });

      // Spec §30: score rotations for this held name against the top BUY slate.
      // The held row's exit cost is proxied by its scan cost (side-symmetric —
      // the gate uses the same C_side for entry and exit at 0.65 modeled).
      const holdingRotationInput: RotationHolding = {
        symbol: p.symbol,
        role: scanRow.role,
        netBps: Math.max(0, scanRow.net),
        modelEdgeBps: scanRow.modelEdge,
        exitCostBps: scanRow.cost * 0.65, // spec §59 BUY exit modeled scale
      };
      const rotations = scoreRotations(holdingRotationInput, rotationTargets);
      const bestRotation = rotations.length > 0 ? rotations[0] : null;

      const sell = sellDecision({
        price: currentPrice,
        stop,
        target,
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
        stop,
        target,
        rr,
        decision: sell.decision,
        reason: sell.reason,
        rotateTo: sell.rotateTo,
        bestRotationBps: bestRotation?.cleared ? bestRotation.netAdvantageBps : 0,
      };
    });
  }, [snapshot, positions]);
}
