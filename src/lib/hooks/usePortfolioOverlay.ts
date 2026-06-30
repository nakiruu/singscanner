"use client";

import { useMemo } from "react";
import { calibrate, parseHorizon } from "@/lib/engine/horizon";
import { computeStopTarget } from "@/lib/engine/levels";
import { sellDecision } from "@/lib/engine/sell";
import type { ScanRow, ScanSnapshot } from "@/lib/engine/types";
import type { PortfolioEntry, PortfolioOverlayRow } from "@/lib/portfolio/types";

// TODO: per-symbol annualized vol should come from the bars fetcher when it ships.
// For now we use a single fleet-wide assumption matching the design spec.
const ASSUMED_VOL_ANN = 0.3;

// Hardcoded "5d" fallback per spec — the engine wants a horizon spec string
// like "5m" / "1h" / "3d". NEXT_PUBLIC_SCANNER_HORIZON lets ops tweak it.
const DEFAULT_HORIZON = "5d";

export function usePortfolioOverlay(
  snapshot: ScanSnapshot | null,
  positions: PortfolioEntry[],
): PortfolioOverlayRow[] {
  return useMemo(() => {
    const horizonSpec = process.env.NEXT_PUBLIC_SCANNER_HORIZON ?? DEFAULT_HORIZON;
    const horizonMin = parseHorizon(horizonSpec);
    const calib = calibrate(horizonMin);
    const holdingDays = Math.max(1, horizonMin / 390);

    // Index scan rows by symbol once.
    const rowBySymbol = new Map<string, ScanRow>();
    if (snapshot) {
      for (const r of snapshot.rows) rowBySymbol.set(r.symbol, r);
    }

    return positions.map((p): PortfolioOverlayRow => {
      const scanRow = rowBySymbol.get(p.symbol) ?? null;
      const currentPrice = scanRow?.price ?? null;
      const pnlDollars =
        currentPrice != null ? p.qty * (currentPrice - p.costBasis) : 0;
      const pnlPercent =
        currentPrice != null && p.costBasis > 0
          ? (currentPrice - p.costBasis) / p.costBasis
          : 0;

      // No scan data → display fallbacks, decision = HOLD with reason.
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

      const sell = sellDecision({
        price: currentPrice,
        stop,
        target,
        composite: scanRow.composite,
        isMember: scanRow.role === "primary" || scanRow.role === "secondary",
        isRetained: scanRow.role === "retained",
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
      };
    });
  }, [snapshot, positions]);
}
