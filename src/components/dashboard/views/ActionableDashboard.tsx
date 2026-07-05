"use client";

// Single-view actionable dashboard.
//
// SPECLIST §29/§30/§57: the practical system's job is to surface the actions
// that would change the account state. This view shows ONLY those:
//   1. Held positions with a SELL, ROTATE, or HOLD recommendation, pinned to
//      the top and sorted by urgency (SELL > ROTATE > HOLD).
//   2. Fresh BUY picks from the scan, filtered to starred or primary-role
//      candidates so the noise floor of WAIT/HOLD-CASH rows never appears.
//
// The scanner never auto-executes. Every row here is a suggestion.

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Circle, Loader2, Sparkles } from "lucide-react";
import { DecisionBadge } from "@/components/dashboard/DecisionBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { usePortfolio } from "@/lib/hooks/usePortfolio";
import { usePortfolioOverlay } from "@/lib/hooks/usePortfolioOverlay";
import { useScanStream, type ScanStreamStatus } from "@/lib/hooks/useScanStream";
import type { ScanRow, ScanSnapshot } from "@/lib/engine/types";
import type { PortfolioOverlayRow } from "@/lib/portfolio/types";

// -- Decision urgency ordering ------------------------------------------------

const URGENCY: Record<PortfolioOverlayRow["decision"], number> = {
  SELL: 0,
  ROTATE: 1,
  HOLD: 2,
  BUY: 3,
  WAIT: 4,
  "HOLD-CASH": 5,
};

function sortByUrgency(a: PortfolioOverlayRow, b: PortfolioOverlayRow): number {
  const du = (URGENCY[a.decision] ?? 99) - (URGENCY[b.decision] ?? 99);
  if (du !== 0) return du;
  // Within same decision, biggest EV first.
  const av = Math.abs(a.scanRow?.net ?? 0);
  const bv = Math.abs(b.scanRow?.net ?? 0);
  return bv - av;
}

// A row is worth surfacing as a BUY candidate if the model actually WANTS the
// user to move on it — the star flag OR a primary role role clearing the gate.
function isActionableBuy(row: ScanRow): boolean {
  return row.decision === "BUY" && (row.star || row.role === "primary");
}

// -- Component ----------------------------------------------------------------

export function ActionableDashboard() {
  const { snapshot, status, lastUpdate } = useScanStream();
  const { positions, loading: portfolioLoading } = usePortfolio();
  const overlay = usePortfolioOverlay(snapshot, positions);

  const sortedHoldings = useMemo(
    () => [...overlay].sort(sortByUrgency),
    [overlay],
  );

  const buyPicks = useMemo(() => {
    const rows = snapshot?.rows ?? [];
    return rows
      .filter(isActionableBuy)
      // Held names already appear in the top section — no duplicates.
      .filter((r) => !overlay.some((h) => h.symbol === r.symbol))
      .sort((a, b) => (b.starScore ?? b.net) - (a.starScore ?? a.net));
  }, [snapshot, overlay]);

  const heldCount = sortedHoldings.length;
  const buyCount = buyPicks.length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <HeaderBar
        status={status}
        lastUpdate={lastUpdate}
        heldCount={heldCount}
        buyCount={buyCount}
        cashWeight={snapshot?.cashWeight ?? null}
      />

      <PortfolioSection
        rows={sortedHoldings}
        loading={portfolioLoading}
      />

      <BuyPicksSection rows={buyPicks} snapshot={snapshot} />
    </div>
  );
}

// -- Header -------------------------------------------------------------------

interface HeaderBarProps {
  status: ScanStreamStatus;
  lastUpdate: number | null;
  heldCount: number;
  buyCount: number;
  cashWeight: number | null;
}

function HeaderBar({ status, lastUpdate, heldCount, buyCount, cashWeight }: HeaderBarProps) {
  const label =
    status === "live"       ? "Live"
  : status === "polling"    ? "Polling"
  : status === "connecting" ? "Connecting"
  : status === "error"      ? "Error"
                            : "Idle";
  const dotClass =
    status === "live"       ? "bg-success"
  : status === "polling"    ? "bg-tertiary"
  : status === "error"      ? "bg-error"
                            : "bg-terminal-gray";

  // Age tick — driven by a 1s interval so we can compute "updated Xs ago"
  // without calling Date.now() during render (React purity rule).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (lastUpdate == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lastUpdate]);
  const ageSec = lastUpdate != null && now != null
    ? Math.max(0, Math.floor((now - lastUpdate) / 1000))
    : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface-low px-5 py-4">
      <div className="flex items-center gap-2">
        <span className={cn("inline-block h-2 w-2 rounded-full", dotClass)} />
        <span className="font-mono text-xs uppercase tracking-wider text-on-surface-variant">
          Engine · {label}
        </span>
        {ageSec != null && (
          <span className="font-mono text-xs text-on-surface-variant">
            · updated {ageSec}s ago
          </span>
        )}
      </div>
      <div className="flex items-center gap-5 font-mono text-xs">
        <Stat label="Holdings" value={heldCount.toString()} />
        <Stat label="BUY picks" value={buyCount.toString()} />
        {cashWeight != null && (
          <Stat label="Cash" value={`${Math.round(cashWeight * 100)}%`} />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-on-surface-variant">{label}</span>
      <span className="font-semibold text-on-surface tabular-nums">{value}</span>
    </div>
  );
}

// -- Portfolio (top) ----------------------------------------------------------

function PortfolioSection({
  rows,
  loading,
}: {
  rows: PortfolioOverlayRow[];
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your positions</CardTitle>
        <span className="font-mono text-[11px] text-on-surface-variant">
          {rows.length} {rows.length === 1 ? "position" : "positions"}
        </span>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center gap-2 px-5 py-6 font-mono text-xs text-on-surface-variant">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading portfolio…
          </div>
        ) : rows.length === 0 ? (
          <EmptyRow msg="No positions yet — add one from the Portfolio page." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <PortfolioRow key={r.symbol} row={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PortfolioRow({ row }: { row: PortfolioOverlayRow }) {
  const { symbol, qty, currentPrice, pnlPercent, pnlDollars, decision, reason } = row;

  return (
    <li className="grid grid-cols-12 items-center gap-3 px-5 py-3 text-sm">
      {/* Symbol + qty */}
      <div className="col-span-3 flex items-center gap-3">
        <div className="flex flex-col">
          <span className="font-mono text-[13px] font-semibold text-on-surface">{symbol}</span>
          <span className="font-mono text-[11px] text-on-surface-variant">
            {qty.toLocaleString()} sh
          </span>
        </div>
      </div>

      {/* Price + P/L */}
      <div className="col-span-3 flex flex-col text-right font-mono tabular-nums">
        <span className="text-on-surface">
          {currentPrice != null ? `$${currentPrice.toFixed(2)}` : "—"}
        </span>
        <span
          className={cn(
            "text-[11px]",
            pnlDollars > 0 ? "text-success" : pnlDollars < 0 ? "text-error" : "text-on-surface-variant",
          )}
        >
          {pnlDollars >= 0 ? "+" : ""}
          {pnlDollars.toFixed(0)} · {(pnlPercent * 100).toFixed(1)}%
        </span>
      </div>

      {/* Levels */}
      <div className="col-span-3 flex flex-col text-right font-mono tabular-nums text-[11px] text-on-surface-variant">
        <span>
          TP {row.takeProfitLimit > 0 ? `$${row.takeProfitLimit.toFixed(2)}` : "—"}
        </span>
        <span>
          SL {row.trailingStopLimit > 0 ? `$${row.trailingStopLimit.toFixed(2)}` : "—"}
        </span>
      </div>

      {/* Decision + reason */}
      <div className="col-span-3 flex flex-col items-end gap-1">
        <DecisionBadge decision={decision} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
          {decision === "ROTATE" && row.rotateTo ? (
            <span className="inline-flex items-center gap-1">
              → {row.rotateTo}
              <ArrowRight className="h-3 w-3" />
            </span>
          ) : (
            reason
          )}
        </span>
      </div>
    </li>
  );
}

// -- BUY picks (bottom) -------------------------------------------------------

function BuyPicksSection({
  rows,
  snapshot,
}: {
  rows: ScanRow[];
  snapshot: ScanSnapshot | null;
}) {
  const horizon = snapshot?.horizon ?? "5d";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Actionable BUY picks · {horizon}</CardTitle>
        <span className="font-mono text-[11px] text-on-surface-variant">
          Only starred or primary-role rows are shown.
        </span>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <EmptyRow
            msg={
              snapshot
                ? "Nothing clears the gate right now — waiting is optimal."
                : "Awaiting first scan…"
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <BuyPickRow key={r.symbol} row={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BuyPickRow({ row }: { row: ScanRow }) {
  // Show the 5d rung target if present; fall back to composite-implied.
  const rung = row.horizonLadder.find((r) => r.horizonSpec === "5d") ?? row.horizonLadder[0];
  const targetPx = rung?.fairValueTarget ?? row.price;
  const upsidePct = ((targetPx - row.price) / row.price) * 100;

  return (
    <li className="grid grid-cols-12 items-center gap-3 px-5 py-3 text-sm">
      {/* Symbol + star */}
      <div className="col-span-3 flex items-center gap-2">
        {row.star ? (
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Circle className="h-3.5 w-3.5 text-on-surface-variant" />
        )}
        <span className="font-mono text-[13px] font-semibold text-on-surface">
          {row.symbol}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
          {row.role}
        </span>
      </div>

      {/* Price + upside */}
      <div className="col-span-3 flex flex-col text-right font-mono tabular-nums">
        <span className="text-on-surface">${row.price.toFixed(2)}</span>
        <span className="text-[11px] text-success">
          → ${targetPx.toFixed(2)}{" "}
          <span className="text-on-surface-variant">
            (+{upsidePct.toFixed(1)}%)
          </span>
        </span>
      </div>

      {/* Gate net / composite */}
      <div className="col-span-3 flex flex-col text-right font-mono tabular-nums text-[11px]">
        <span
          className={cn(
            row.net > 0 ? "text-success" : "text-on-surface-variant",
          )}
        >
          net {row.net >= 0 ? "+" : ""}
          {row.net.toFixed(0)} bps
        </span>
        <span className="text-on-surface-variant">
          conf {Math.round(row.confidence * 100)}%
        </span>
      </div>

      {/* Decision */}
      <div className="col-span-3 flex items-center justify-end">
        <DecisionBadge decision={row.decision} />
      </div>
    </li>
  );
}

function EmptyRow({ msg }: { msg: string }) {
  return (
    <div className="px-5 py-6 font-mono text-xs text-on-surface-variant">
      {msg}
    </div>
  );
}
