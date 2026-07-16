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

// Portfolio-level summary metrics computed from the overlay rows. Cheap;
// runs on every render but bounded by holdings count (~dozens).
function summarize(rows: readonly PortfolioOverlayRow[]) {
  let invested = 0;
  let value = 0;
  const perName: number[] = [];
  let pricedNames = 0;

  for (const r of rows) {
    const cb = r.qty * r.costBasis;
    invested += cb;
    if (r.currentPrice != null) {
      const v = r.qty * r.currentPrice;
      value += v;
      perName.push(v);
      pricedNames++;
    } else {
      perName.push(cb);
    }
  }

  const pnl = value - invested;
  const pnlPct = invested > 0 ? pnl / invested : 0;
  // Herfindahl on current-value weights.
  const totalW = perName.reduce((s, x) => s + x, 0);
  const weights = totalW > 0 ? perName.map((x) => x / totalW) : perName.map(() => 0);
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  const top3 = weights.slice().sort((a, b) => b - a).slice(0, 3).reduce((s, w) => s + w, 0);
  return { invested, value, pnl, pnlPct, hhi, top3, pricedNames };
}

function pctColor(v: number, showZeroNeutral = false): string {
  if (v > 0) return "text-success";
  if (v < 0) return "text-error";
  return showZeroNeutral ? "text-on-surface-variant" : "text-on-surface";
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
  const summary = summarize(overlay);

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

      {/* Hero strip — total value + P&L. Today's delta needs day-open
          prices which aren't threaded through the scan stream yet; shown
          as placeholder until that lands. */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-6 pt-6 md:grid-cols-4">
          <HeroStat
            label="Total value"
            value={overlay.length === 0 ? "—" : `$${summary.value.toFixed(2)}`}
            sub={
              overlay.length === 0
                ? ""
                : `${summary.pricedNames} of ${overlay.length} priced live`
            }
          />
          <HeroStat
            label="Today"
            value="—"
            sub="needs day-open prices"
          />
          <HeroStat
            label="Cumulative"
            value={
              summary.invested === 0
                ? "—"
                : `${summary.pnl >= 0 ? "+" : ""}$${summary.pnl.toFixed(2)}`
            }
            sub={
              summary.invested === 0
                ? ""
                : `${summary.pnl >= 0 ? "+" : ""}${(summary.pnlPct * 100).toFixed(2)}%`
            }
            valueTone={pctColor(summary.pnl, true)}
            subTone={pctColor(summary.pnlPct, true)}
          />
          <HeroStat
            label="Cash"
            value="—"
            sub="brokerage-adapter follow-up"
          />
        </CardContent>
      </Card>

      {/* Three summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Concentration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 font-mono text-[12px]">
            <SummaryRow
              label="Top-3 weight"
              value={overlay.length === 0 ? "—" : `${(summary.top3 * 100).toFixed(1)}%`}
              tone={
                summary.top3 > 0.6 ? "text-error"
                : summary.top3 > 0.4 ? "text-tertiary"
                : "text-on-surface"
              }
            />
            <SummaryRow
              label="Herfindahl"
              value={overlay.length === 0 ? "—" : summary.hhi.toFixed(3)}
              tone={
                summary.hhi > 0.25 ? "text-error"
                : summary.hhi > 0.15 ? "text-tertiary"
                : "text-on-surface"
              }
            />
            <p className="mt-2 text-[10px] text-on-surface-variant">
              Herfindahl &gt; 0.25 = highly concentrated. Consider rotation.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sector split</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              aria-hidden="true"
              className="flex h-20 items-center justify-center rounded border border-dashed border-border/60 bg-surface-low font-mono text-[10px] text-on-surface-variant"
            >
              Treemap placeholder · needs sector data plumbing
            </div>
            <p className="mt-2 font-mono text-[10px] text-on-surface-variant">
              Sector data lands with the FMP-fundamentals sector-tag PR.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>30-day P&amp;L</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              aria-hidden="true"
              className="flex h-20 items-center justify-center rounded border border-dashed border-border/60 bg-surface-low font-mono text-[10px] text-on-surface-variant"
            >
              Sparkline placeholder · needs portfolio-value history
            </div>
            <p className="mt-2 font-mono text-[10px] text-on-surface-variant">
              History table + sparkline land with the value-snapshot PR.
            </p>
          </CardContent>
        </Card>
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

// -- Hero / summary primitives ----------------------------------------------

function HeroStat({
  label,
  value,
  sub,
  valueTone,
  subTone,
}: {
  label: string;
  value: string;
  sub?: string;
  valueTone?: string;
  subTone?: string;
}) {
  return (
    <div>
      <div className="label-caps font-mono">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl font-semibold tabular-nums", valueTone ?? "text-on-surface")}>
        {value}
      </div>
      {sub && (
        <div className={cn("mt-0.5 font-mono text-[11px]", subTone ?? "text-on-surface-variant")}>
          {sub}
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/60 py-1 last:border-b-0">
      <span className="text-on-surface-variant">{label}</span>
      <span className={cn("tabular-nums", tone ?? "text-on-surface")}>{value}</span>
    </div>
  );
}
