"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DecisionBadge } from "@/components/dashboard/DecisionBadge";
import { ExchangeChip } from "@/components/dashboard/ExchangeChip";
import { MQLRBars } from "@/components/dashboard/MQLRBars";
import { AddPositionDialog } from "@/components/portfolio/AddPositionDialog";
import { useScanStream } from "@/lib/hooks/useScanStream";
import { usePortfolio } from "@/lib/hooks/usePortfolio";
import { usePortfolioOverlay } from "@/lib/hooks/usePortfolioOverlay";
import { exchangeFor } from "@/lib/ui-helpers";
import { cn } from "@/lib/utils";
import type { PortfolioOverlayRow } from "@/lib/portfolio/types";

const HEADERS: ReadonlyArray<{ id: string; label: string; align?: "left" | "right" | "center" }> = [
  { id: "rank", label: "#", align: "left" },
  { id: "symbol", label: "Symbol", align: "left" },
  { id: "shares", label: "Shares", align: "right" },
  { id: "cb", label: "Cost Basis", align: "right" },
  { id: "price", label: "Current", align: "right" },
  { id: "pnl$", label: "P&L $", align: "right" },
  { id: "pnl%", label: "P&L %", align: "right" },
  { id: "stop", label: "Stop", align: "right" },
  { id: "target", label: "Target", align: "right" },
  { id: "rr", label: "R:R", align: "right" },
  { id: "mqlr", label: "M·Q·L·R", align: "center" },
  { id: "decision", label: "Decision", align: "left" },
  { id: "act", label: "", align: "right" },
];

function pnlTone(v: number): string {
  if (v > 0) return "text-primary";
  if (v < 0) return "text-error";
  return "text-on-surface-variant";
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function fmtPct(v: number): string {
  const pct = v * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function fmtSignedUsd(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

function stopClassName(row: PortfolioOverlayRow): string {
  if (row.currentPrice == null || row.stop <= 0) return "text-on-surface-variant";
  // Warn when stop sits within 3% of the live price (per spec "warn<3%").
  const distancePct = (row.currentPrice - row.stop) / row.currentPrice;
  if (distancePct < 0.03) return "text-error font-semibold";
  return "text-error";
}

interface PortfolioRowProps {
  row: PortfolioOverlayRow;
  index: number;
  onRemove: (symbol: string) => Promise<void>;
  snapshotHorizon?: string;
}

function PortfolioRow({ row, index, onRemove, snapshotHorizon }: PortfolioRowProps) {
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    if (!confirm(`Remove ${row.symbol} from portfolio?`)) return;
    setRemoving(true);
    try {
      await onRemove(row.symbol);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <tr className="border-b border-border/60 transition hover:bg-surface-low/50">
      <td className="px-3 py-2 font-mono text-xs text-terminal-gray">
        {String(index + 1).padStart(2, "0")}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-on-surface">{row.symbol}</span>
          <ExchangeChip exchange={exchangeFor(row.symbol)} />
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-on-surface">
        {row.qty}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-on-surface">
        {row.costBasis.toFixed(2)}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-on-surface">
        {fmtUsd(row.currentPrice)}
      </td>
      <td className={cn("px-3 py-2 text-right font-mono tabular-nums", pnlTone(row.pnlDollars))}>
        {row.currentPrice == null ? "—" : fmtSignedUsd(row.pnlDollars)}
      </td>
      <td className={cn("px-3 py-2 text-right font-mono tabular-nums", pnlTone(row.pnlPercent))}>
        {row.currentPrice == null ? "—" : fmtPct(row.pnlPercent)}
      </td>
      <td className={cn("px-3 py-2 text-right font-mono tabular-nums", stopClassName(row))}>
        {row.stop > 0 ? row.stop.toFixed(2) : "—"}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right font-mono tabular-nums",
          row.target > 0 ? "text-primary" : "text-on-surface-variant",
        )}
      >
        {row.target > 0 ? row.target.toFixed(2) : "—"}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-on-surface">
        {row.rr > 0 ? row.rr.toFixed(2) : "—"}
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-center">
          {row.scanRow ? (
            <MQLRBars
              M={row.scanRow.momentum}
              Q={row.scanRow.quality}
              L={row.scanRow.liquidity}
              R={row.scanRow.risk}
            />
          ) : (
            <span className="font-mono text-xs text-terminal-gray">—</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <DecisionBadge
            decision={row.decision}
            row={row.scanRow ?? undefined}
            horizon={row.scanRow ? snapshotHorizon : undefined}
          />
          <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            {row.reason}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          aria-label={`Remove ${row.symbol}`}
          onClick={handleRemove}
          disabled={removing}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-on-surface-variant hover:bg-error/10 hover:text-error disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

export default function PortfolioPage() {
  const { snapshot, status } = useScanStream();
  const {
    positions,
    loading,
    error,
    addPosition,
    removePosition,
  } = usePortfolio();
  const overlay = usePortfolioOverlay(snapshot, positions);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-sans text-2xl font-semibold">Portfolio</h1>
          <p className="font-mono text-xs text-terminal-gray">
            Scan stream: {status}
            {snapshot && (
              <span className="ml-2">
                · {snapshot.rows.length} symbols · horizon {snapshot.horizon}
              </span>
            )}
          </p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          Add position
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Positions ({positions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-3 font-mono text-xs text-error" role="alert">
              {error}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  {HEADERS.map((h) => (
                    <th
                      key={h.id}
                      scope="col"
                      className={cn(
                        "label-caps whitespace-nowrap px-3 py-2",
                        h.align === "right" && "text-right",
                        h.align === "center" && "text-center",
                        h.align !== "right" && h.align !== "center" && "text-left",
                      )}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && positions.length === 0 && (
                  <tr>
                    <td
                      colSpan={HEADERS.length}
                      className="px-3 py-8 text-center font-mono text-xs text-terminal-gray"
                    >
                      Loading positions…
                    </td>
                  </tr>
                )}
                {!loading && positions.length === 0 && (
                  <tr>
                    <td
                      colSpan={HEADERS.length}
                      className="px-3 py-8 text-center font-mono text-xs text-terminal-gray"
                    >
                      No positions yet. Add one to overlay stop / target / decision on live scans.
                    </td>
                  </tr>
                )}
                {overlay.map((row, i) => (
                  <PortfolioRow
                    key={row.symbol}
                    row={row}
                    index={i}
                    onRemove={removePosition}
                    snapshotHorizon={snapshot?.horizon}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {dialogOpen && (
        <AddPositionDialog
          open
          onClose={() => setDialogOpen(false)}
          onSubmit={addPosition}
        />
      )}
    </div>
  );
}
