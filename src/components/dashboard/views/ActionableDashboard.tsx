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
// The scanner never auto-executes. Every decision badge opens the add-position
// dialog prefilled with the row's context.

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Circle, Loader2, Sparkles } from "lucide-react";
import { DecisionBadge } from "@/components/dashboard/DecisionBadge";
import { MQLRBars } from "@/components/dashboard/MQLRBars";
import { AddPositionDialog } from "@/components/portfolio/AddPositionDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { usePortfolio } from "@/lib/hooks/usePortfolio";
import { usePortfolioOverlay } from "@/lib/hooks/usePortfolioOverlay";
import { useScanStream, type ScanStreamStatus } from "@/lib/hooks/useScanStream";
import { HORIZON_PRESETS, type HorizonPreset } from "@/lib/engine/horizon";
import type { ScanRow, ScanSnapshot } from "@/lib/engine/types";
import type { PortfolioOverlayRow } from "@/lib/portfolio/types";

// Which horizon preset the dashboard starts on. 5d matches the SPECLIST
// default and the server-side SCANNER_HORIZON env fallback.
const DEFAULT_HORIZON: HorizonPreset = "5d";

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
  const av = Math.abs(a.scanRow?.net ?? 0);
  const bv = Math.abs(b.scanRow?.net ?? 0);
  return bv - av;
}

// A row is worth surfacing as a BUY candidate if the model actually WANTS the
// user to move on it — the star flag OR a primary role clearing the gate.
function isActionableBuy(row: ScanRow): boolean {
  return row.decision === "BUY" && (row.star || row.role === "primary");
}

// -- Dialog prefill wrapper ---------------------------------------------------

interface DialogState {
  open: boolean;
  symbol: string;
  qty: number | null;
  costBasis: number | null;
}

const CLOSED_DIALOG: DialogState = { open: false, symbol: "", qty: null, costBasis: null };

// -- Component ----------------------------------------------------------------

export function ActionableDashboard() {
  const [horizon, setHorizon] = useState<HorizonPreset>(DEFAULT_HORIZON);
  const { snapshot, status, lastUpdate } = useScanStream(horizon);
  const { positions, loading: portfolioLoading, addPosition } = usePortfolio();
  const overlay = usePortfolioOverlay(snapshot, positions, horizon);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(CLOSED_DIALOG);

  // Collapse any expanded row when horizon flips so the detail panel doesn't
  // linger with stale data before the next snapshot arrives.
  useEffect(() => {
    setExpanded(null);
  }, [horizon]);

  const sortedHoldings = useMemo(
    () => [...overlay].sort(sortByUrgency),
    [overlay],
  );

  const buyPicks = useMemo(() => {
    const rows = snapshot?.rows ?? [];
    return rows
      .filter(isActionableBuy)
      .filter((r) => !overlay.some((h) => h.symbol === r.symbol))
      .sort((a, b) => (b.starScore ?? b.net) - (a.starScore ?? a.net));
  }, [snapshot, overlay]);

  const toggleExpand = (symbol: string) =>
    setExpanded((prev) => (prev === symbol ? null : symbol));

  // Open the dialog with a preferred prefill. For BUY picks we suggest the
  // current price as cost basis; for held positions we pre-fill the existing
  // qty + cost basis so the POST upserts an "adjust" rather than a fresh add.
  const openDialogForBuy = (row: ScanRow) =>
    setDialog({ open: true, symbol: row.symbol, qty: null, costBasis: row.price });
  const openDialogForHeld = (row: PortfolioOverlayRow) =>
    setDialog({
      open: true,
      symbol: row.symbol,
      qty: row.qty,
      costBasis: row.costBasis,
    });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <HeaderBar
        status={status}
        lastUpdate={lastUpdate}
        heldCount={sortedHoldings.length}
        buyCount={buyPicks.length}
        cashWeight={snapshot?.cashWeight ?? null}
        horizon={horizon}
        onHorizonChange={setHorizon}
      />

      <PortfolioSection
        rows={sortedHoldings}
        loading={portfolioLoading}
        expandedSymbol={expanded}
        onToggle={toggleExpand}
        onDecisionClick={openDialogForHeld}
      />

      <BuyPicksSection
        rows={buyPicks}
        snapshot={snapshot}
        expandedSymbol={expanded}
        onToggle={toggleExpand}
        onDecisionClick={openDialogForBuy}
      />

      {dialog.open && (
        <AddPositionDialog
          open
          onClose={() => setDialog(CLOSED_DIALOG)}
          onSubmit={addPosition}
          initialSymbol={dialog.symbol}
          initialQty={dialog.qty}
          initialCostBasis={dialog.costBasis}
        />
      )}
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
  horizon: HorizonPreset;
  onHorizonChange: (h: HorizonPreset) => void;
}

function HeaderBar({
  status,
  lastUpdate,
  heldCount,
  buyCount,
  cashWeight,
  horizon,
  onHorizonChange,
}: HeaderBarProps) {
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
      <div className="flex items-center gap-5">
        <HorizonSelector value={horizon} onChange={onHorizonChange} />
        <div className="flex items-center gap-5 font-mono text-xs">
          <Stat label="Holdings" value={heldCount.toString()} />
          <Stat label="BUY picks" value={buyCount.toString()} />
          {cashWeight != null && (
            <Stat label="Cash" value={`${Math.round(cashWeight * 100)}%`} />
          )}
        </div>
      </div>
    </div>
  );
}

// Four-preset segmented control. Ordered short → long: 3d, 5d, 10d, 21d.
// Clicking a preset re-runs the scan against the selected horizon and clears
// stale state — see useEffect + useScanStream in the parent.
function HorizonSelector({
  value,
  onChange,
}: {
  value: HorizonPreset;
  onChange: (h: HorizonPreset) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Horizon"
      className="inline-flex items-center rounded-md border border-border bg-surface-lowest p-0.5"
    >
      {HORIZON_PRESETS.map((h) => {
        const active = h === value;
        return (
          <button
            key={h}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(h)}
            className={cn(
              "rounded px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors",
              active
                ? "bg-surface-high text-on-surface"
                : "text-on-surface-variant hover:bg-surface-low hover:text-on-surface",
            )}
          >
            {h}
          </button>
        );
      })}
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
  expandedSymbol,
  onToggle,
  onDecisionClick,
}: {
  rows: PortfolioOverlayRow[];
  loading: boolean;
  expandedSymbol: string | null;
  onToggle: (symbol: string) => void;
  onDecisionClick: (row: PortfolioOverlayRow) => void;
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
              <PortfolioRow
                key={r.symbol}
                row={r}
                isExpanded={expandedSymbol === r.symbol}
                onToggle={() => onToggle(r.symbol)}
                onDecisionClick={() => onDecisionClick(r)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PortfolioRow({
  row,
  isExpanded,
  onToggle,
  onDecisionClick,
}: {
  row: PortfolioOverlayRow;
  isExpanded: boolean;
  onToggle: () => void;
  onDecisionClick: () => void;
}) {
  const { symbol, qty, currentPrice, pnlPercent, pnlDollars, decision, reason } = row;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={`row-detail-${symbol}`}
        className={cn(
          "grid w-full grid-cols-12 items-center gap-3 px-5 py-3 text-left text-sm transition-colors",
          "hover:bg-surface-default focus:outline-none focus-visible:bg-surface-default",
        )}
      >
        {/* Symbol + qty */}
        <div className="col-span-3 flex items-center gap-3">
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-on-surface-variant transition-transform",
              isExpanded && "rotate-180",
            )}
          />
          <div className="flex flex-col">
            <span className="font-mono text-[13px] font-semibold text-on-surface">
              {symbol}
            </span>
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
              pnlDollars > 0
                ? "text-success"
                : pnlDollars < 0
                  ? "text-error"
                  : "text-on-surface-variant",
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

        {/* Decision button */}
        <div className="col-span-3 flex flex-col items-end gap-1">
          <DecisionButton decision={decision} onClick={onDecisionClick} />
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
      </button>

      {isExpanded && row.scanRow && (
        <RowDetails id={`row-detail-${symbol}`} row={row.scanRow} />
      )}
    </li>
  );
}

// -- BUY picks (bottom) -------------------------------------------------------

function BuyPicksSection({
  rows,
  snapshot,
  expandedSymbol,
  onToggle,
  onDecisionClick,
}: {
  rows: ScanRow[];
  snapshot: ScanSnapshot | null;
  expandedSymbol: string | null;
  onToggle: (symbol: string) => void;
  onDecisionClick: (row: ScanRow) => void;
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
              <BuyPickRow
                key={r.symbol}
                row={r}
                isExpanded={expandedSymbol === r.symbol}
                onToggle={() => onToggle(r.symbol)}
                onDecisionClick={() => onDecisionClick(r)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BuyPickRow({
  row,
  isExpanded,
  onToggle,
  onDecisionClick,
}: {
  row: ScanRow;
  isExpanded: boolean;
  onToggle: () => void;
  onDecisionClick: () => void;
}) {
  const targetPx = row.takeProfitLimitPx > 0 ? row.takeProfitLimitPx : row.fairValueTargetPx;
  const upsidePct = targetPx > 0 ? ((targetPx - row.price) / row.price) * 100 : 0;
  const stopPx = row.stopLimitPx > 0 ? row.stopLimitPx : row.stopPx;
  const downsidePct = stopPx > 0 ? ((row.price - stopPx) / row.price) * 100 : 0;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={`row-detail-${row.symbol}`}
        className={cn(
          "grid w-full grid-cols-12 items-center gap-3 px-5 py-3 text-left text-sm transition-colors",
          "hover:bg-surface-default focus:outline-none focus-visible:bg-surface-default",
        )}
      >
        {/* Symbol + star */}
        <div className="col-span-3 flex items-center gap-2">
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-on-surface-variant transition-transform",
              isExpanded && "rotate-180",
            )}
          />
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

        {/* Price + TP + SL */}
        <div className="col-span-3 flex flex-col text-right font-mono tabular-nums">
          <span className="text-on-surface">${row.price.toFixed(2)}</span>
          {targetPx > 0 && (
            <span className="text-[11px] text-success">
              TP ${targetPx.toFixed(2)}{" "}
              <span className="text-on-surface-variant">(+{upsidePct.toFixed(1)}%)</span>
            </span>
          )}
          {stopPx > 0 && (
            <span className="text-[11px] text-error">
              SL ${stopPx.toFixed(2)}{" "}
              <span className="text-on-surface-variant">(−{downsidePct.toFixed(1)}%)</span>
            </span>
          )}
        </div>

        {/* Gate net / confidence */}
        <div className="col-span-3 flex flex-col text-right font-mono tabular-nums text-[11px]">
          <span
            className={cn(row.net > 0 ? "text-success" : "text-on-surface-variant")}
          >
            net {row.net >= 0 ? "+" : ""}
            {row.net.toFixed(0)} bps
          </span>
          <span className="text-on-surface-variant">
            conf {Math.round(row.confidence * 100)}%
          </span>
        </div>

        {/* Decision button */}
        <div className="col-span-3 flex items-center justify-end">
          <DecisionButton decision={row.decision} onClick={onDecisionClick} />
        </div>
      </button>

      {isExpanded && (
        <RowDetails id={`row-detail-${row.symbol}`} row={row} />
      )}
    </li>
  );
}

// -- Shared: clickable decision badge ----------------------------------------

function DecisionButton({
  decision,
  onClick,
}: {
  decision: PortfolioOverlayRow["decision"];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Stop the surrounding row toggle from firing.
        e.stopPropagation();
        onClick();
      }}
      aria-label={`${decision} — open add position dialog`}
      className="rounded-sm outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-primary"
    >
      <DecisionBadge decision={decision} />
    </button>
  );
}

// -- Expansion panel: score detail per row -----------------------------------

function RowDetails({ id, row }: { id: string; row: ScanRow }) {
  return (
    <div
      id={id}
      className="border-t border-border bg-surface-lowest px-5 py-4"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Signal families */}
        <DetailBlock title="Signal families">
          <div className="mb-3 flex items-center gap-2">
            <MQLRBars M={row.momentum} Q={row.quality} L={row.liquidity} R={row.risk} size="md" />
            <span className="font-mono text-[11px] text-on-surface-variant">
              composite {Math.round(row.composite)}
            </span>
          </div>
          <DetailRow label="Momentum"  value={row.momentum.toFixed(0)} />
          <DetailRow label="Quality"   value={row.quality.toFixed(0)} />
          <DetailRow label="Liquidity" value={row.liquidity.toFixed(0)} />
          <DetailRow label="Risk"      value={row.risk.toFixed(0)} />
        </DetailBlock>

        {/* Forecast + confidence */}
        <DetailBlock title="Forecast">
          <DetailRow label="P(up)"      value={`${(row.pUp * 100).toFixed(1)}%`} />
          <DetailRow label="μ (bps)"    value={fmtBps(row.mu)} />
          <DetailRow label="Evidence"   value={row.evidence.toFixed(1)} />
          <DetailRow label="Vol (ann)"  value={`${(row.volAnn * 100).toFixed(1)}%`} />
          <DetailRow label="Confidence" value={`${Math.round(row.confidence * 100)}%`} />
          <ConfidenceFactorList factors={row.confidenceFactors} />
        </DetailBlock>

        {/* Gate breakdown */}
        <DetailBlock title="Gate (§59)">
          <DetailRow label="Model edge"     value={fmtBps(row.modelEdge)} tone="pos" />
          <DetailRow label="− Entry"        value={fmtBps(row.cEntry)}    tone="neg" />
          <DetailRow label="− Exit"         value={fmtBps(row.cExit)}     tone="neg" />
          <DetailRow label="− Queue"        value={fmtBps(row.cQueue)}    tone="neg" />
          {row.cMemory > 0 && (
            <DetailRow label="− Memory" value={fmtBps(row.cMemory)} tone="neg" />
          )}
          {row.concentrationBps > 0 && (
            <DetailRow
              label="− Concentration"
              value={fmtBps(row.concentrationBps)}
              tone="neg"
            />
          )}
          <DetailRow
            label="Net"
            value={fmtBps(row.net)}
            tone={row.net > 0 ? "pos" : "neg"}
            strong
          />
        </DetailBlock>
      </div>

      {/* Stops — SPECLIST §11/§15. Only for BUY rows (levels are 0 otherwise). */}
      {(row.stopPx > 0 || row.fairValueTargetPx > 0) && (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          <span className="label-caps">Stops @ {row.price.toFixed(2)}</span>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <PriceLevelTile
              label="TP fair value"
              price={row.fairValueTargetPx}
              refPx={row.price}
              tone="pos"
            />
            <PriceLevelTile
              label="TP limit"
              price={row.takeProfitLimitPx}
              refPx={row.price}
              tone="pos"
              subtitle="inside fair value by ½ spread"
            />
            <PriceLevelTile
              label="SL trigger"
              price={row.stopPx}
              refPx={row.price}
              tone="neg"
            />
            <PriceLevelTile
              label="SL limit"
              price={row.stopLimitPx}
              refPx={row.price}
              tone="neg"
              subtitle="paired below trigger by a full spread"
            />
          </div>
        </div>
      )}

      {/* Horizon ladder + warnings */}
      <div className="mt-4 space-y-2 border-t border-border pt-3">
        <div className="flex items-baseline gap-3">
          <span className="label-caps">Fair-value target ladder</span>
          {row.crossesWeekend && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-tertiary">
              ⚠ crosses weekend/holiday · gap {row.gapDays}d
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {row.horizonLadder.map((r) => {
            const upPct = ((r.fairValueTarget - row.price) / row.price) * 100;
            return (
              <div
                key={r.horizonSpec}
                className="rounded border border-border bg-surface-low px-3 py-2"
              >
                <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                  {r.horizonSpec}
                </div>
                <div className="mt-0.5 font-mono text-sm tabular-nums text-on-surface">
                  ${r.fairValueTarget.toFixed(2)}
                </div>
                <div className="font-mono text-[11px] tabular-nums text-success">
                  +{upPct.toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// A single price-level tile — used by the Stops block. Shows the price and
// the signed % distance from the reference price so users can eyeball risk.
function PriceLevelTile({
  label,
  price,
  refPx,
  tone,
  subtitle,
}: {
  label: string;
  price: number;
  refPx: number;
  tone: "pos" | "neg";
  subtitle?: string;
}) {
  if (price <= 0) {
    return (
      <div className="rounded border border-border bg-surface-low px-3 py-2 opacity-50">
        <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
          {label}
        </div>
        <div className="mt-0.5 font-mono text-sm tabular-nums text-on-surface-variant">
          —
        </div>
      </div>
    );
  }
  const deltaPct = ((price - refPx) / refPx) * 100;
  const sign = deltaPct >= 0 ? "+" : "";
  return (
    <div className="rounded border border-border bg-surface-low px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-on-surface">
        ${price.toFixed(2)}
      </div>
      <div
        className={cn(
          "font-mono text-[11px] tabular-nums",
          tone === "pos" ? "text-success" : "text-error",
        )}
      >
        {sign}
        {deltaPct.toFixed(1)}%
      </div>
      {subtitle && (
        <div className="mt-0.5 font-mono text-[10px] text-on-surface-variant">
          {subtitle}
        </div>
      )}
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface-low p-3">
      <div className="mb-2 label-caps">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] tabular-nums">
      <span className="text-on-surface-variant">{label}</span>
      <span
        className={cn(
          strong && "font-semibold",
          tone === "pos" && "text-success",
          tone === "neg" && "text-error",
          !tone && "text-on-surface",
        )}
      >
        {value}
      </span>
    </div>
  );
}

// Confidence factor list — highlights every factor pulling the multiplier
// below 1. Spec §8: uncertainty is a cost; users see WHY confidence dropped.
function ConfidenceFactorList({
  factors,
}: {
  factors: ScanRow["confidenceFactors"];
}) {
  const entries: Array<[string, number]> = [
    ["source", factors.source],
    ["quote age", factors.staleQuote],
    ["fundamentals", factors.missingFundamentals],
    ["spread", factors.wideSpread],
    ["missing fields", factors.missingFields],
    ["family disagreement", factors.familyDisagreement],
  ];
  const active = entries.filter(([, v]) => v < 0.999);
  if (active.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 border-t border-border pt-1">
      <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
        Haircuts
      </div>
      {active.map(([label, v]) => (
        <div
          key={label}
          className="flex justify-between font-mono text-[11px] tabular-nums text-on-surface-variant"
        >
          <span>{label}</span>
          <span className="text-error">×{v.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function fmtBps(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)} bps`;
}

function EmptyRow({ msg }: { msg: string }) {
  return (
    <div className="px-5 py-6 font-mono text-xs text-on-surface-variant">{msg}</div>
  );
}
