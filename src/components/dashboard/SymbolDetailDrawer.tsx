"use client";

import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DecisionBadge } from "@/components/dashboard/DecisionBadge";
import { ExchangeChip } from "@/components/dashboard/ExchangeChip";
import { calibrate, parseHorizon } from "@/lib/engine/horizon";
import { computeStopTarget } from "@/lib/engine/levels";
import { recommendedSizing, exchangeFor } from "@/lib/ui-helpers";
import type { ScanRow, Role } from "@/lib/engine/types";
import type { SymbolHistorySample } from "@/lib/hooks/useScanStream";
import { cn } from "@/lib/utils";

export interface SymbolDetailDrawerProps {
  row: ScanRow | null;
  horizonSpec?: string;
  history?: SymbolHistorySample[];
  onClose: () => void;
}

// ---------- helpers ----------

function fmtBps(v: number): string {
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(0)} bps`;
}

function fmtPrice(v: number): string {
  return v >= 1000 ? v.toFixed(2) : v.toFixed(2);
}

function rolePillTone(role: Role): "primary" | "warn" | "neutral" | "error" {
  switch (role) {
    case "primary":
      return "primary";
    case "secondary":
      return "warn";
    case "retained":
      return "neutral";
    default:
      return "error";
  }
}

// Width % for a bar relative to the max-of-three absolute magnitudes.
function barWidth(value: number, scale: number): number {
  if (scale <= 0) return 0;
  return Math.min(100, (Math.abs(value) / scale) * 100);
}

// ---------- sub-components ----------

interface GateWaterfallProps {
  modelEdge: number;
  cost: number;
  net: number;
}

function GateWaterfall({ modelEdge, cost, net }: GateWaterfallProps) {
  const scale = Math.max(Math.abs(modelEdge), Math.abs(cost), Math.abs(net), 1);
  const netPositive = net >= 0;

  const rows: ReadonlyArray<{
    label: string;
    value: number;
    barClass: string;
    valueClass: string;
  }> = [
    {
      label: "Model edge",
      value: modelEdge,
      barClass: "bg-primary/70",
      valueClass: "text-primary",
    },
    {
      label: "− Cost wall",
      value: -Math.abs(cost),
      barClass: "bg-error/70",
      valueClass: "text-error",
    },
    {
      label: "= Net surplus",
      value: net,
      barClass: netPositive ? "bg-primary emerald-glow" : "bg-error",
      valueClass: netPositive ? "text-primary" : "text-error",
    },
  ];

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.label} className="flex items-center gap-3">
          <div className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            {r.label}
          </div>
          <div className="relative h-3 flex-1 rounded-sm bg-surface-lowest">
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-sm transition-all",
                r.barClass,
                i === 2 && "border-t border-border/40"
              )}
              style={{ width: `${barWidth(r.value, scale)}%` }}
            />
          </div>
          <div
            className={cn(
              "w-20 shrink-0 text-right font-mono text-xs tabular-nums",
              r.valueClass
            )}
          >
            {fmtBps(r.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

interface CompositeBreakdownProps {
  row: ScanRow;
  wM: number;
  wQ: number;
  wL: number;
  wR: number;
}

function CompositeBreakdown({ row, wM, wQ, wL, wR }: CompositeBreakdownProps) {
  const contribM = wM * row.momentum;
  const contribQ = wQ * row.quality;
  const contribL = wL * row.liquidity;
  const contribR = wR * row.risk;
  const total = contribM + contribQ + contribL + contribR;
  const safeTotal = total > 0 ? total : 1;

  const segs: ReadonlyArray<{
    key: string;
    label: string;
    weight: number;
    score: number;
    contrib: number;
    barClass: string;
    dotClass: string;
  }> = [
    { key: "M", label: "Momentum", weight: wM, score: row.momentum, contrib: contribM, barClass: "bg-primary", dotClass: "bg-primary" },
    { key: "Q", label: "Quality", weight: wQ, score: row.quality, contrib: contribQ, barClass: "bg-primary-bright", dotClass: "bg-primary-bright" },
    { key: "L", label: "Liquidity", weight: wL, score: row.liquidity, contrib: contribL, barClass: "bg-[#4F9DF0]", dotClass: "bg-[#4F9DF0]" },
    { key: "R", label: "Risk", weight: wR, score: row.risk, contrib: contribR, barClass: "bg-tertiary", dotClass: "bg-tertiary" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-sm bg-surface-lowest">
        {segs.map((s) => (
          <div
            key={s.key}
            className={cn("h-full", s.barClass)}
            style={{ width: `${(s.contrib / safeTotal) * 100}%` }}
            title={`${s.label}: ${s.contrib.toFixed(2)}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] tabular-nums">
        {segs.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-on-surface-variant">
              <span className={cn("h-1.5 w-1.5 rounded-sm", s.dotClass)} />
              {s.label}
            </span>
            <span className="text-on-surface">
              {s.weight.toFixed(2)} × {s.score.toFixed(0)} ={" "}
              <span className="text-on-surface">{s.contrib.toFixed(1)}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-border pt-2 font-mono text-xs">
        <span className="label-caps">Composite</span>
        <span className="tabular-nums text-on-surface">{total.toFixed(1)}</span>
      </div>
    </div>
  );
}

interface MuSparklineProps {
  history: SymbolHistorySample[];
}

function MuSparkline({ history }: MuSparklineProps) {
  const { path, last, positive, lo, hi } = useMemo(() => {
    const xs = history.map((h) => h.mu);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const span = max - min || 1;
    const w = 100;
    const h = 100;
    const stepX = history.length > 1 ? w / (history.length - 1) : 0;
    const pts = history.map((s, i) => {
      const x = i * stepX;
      const y = h - ((s.mu - min) / span) * h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return {
      path: `M ${pts.join(" L ")}`,
      last: xs[xs.length - 1],
      positive: xs[xs.length - 1] >= xs[0],
      lo: min,
      hi: max,
    };
  }, [history]);

  const stroke = positive ? "var(--color-primary, #3ECF8E)" : "var(--color-error, #ef4444)";

  return (
    <div className="flex items-center gap-3">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-[60px] flex-1"
        aria-hidden="true"
      >
        <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex w-20 shrink-0 flex-col items-end font-mono text-[10px] tabular-nums text-on-surface-variant">
        <span className={cn(positive ? "text-primary" : "text-error", "text-xs")}>
          {fmtBps(last)}
        </span>
        <span>hi {hi.toFixed(0)}</span>
        <span>lo {lo.toFixed(0)}</span>
      </div>
    </div>
  );
}

// ---------- main component ----------

export function SymbolDetailDrawer({
  row,
  horizonSpec = "5d",
  history,
  onClose,
}: SymbolDetailDrawerProps) {
  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, onClose]);

  const calib = useMemo(() => calibrate(parseHorizon(horizonSpec)), [horizonSpec]);
  const horizonMin = useMemo(() => parseHorizon(horizonSpec), [horizonSpec]);

  const levels = useMemo(() => {
    if (!row) return null;
    return computeStopTarget({
      ref: row.price,
      volAnn: 0.3,
      holdingDays: Math.max(1, horizonMin / 390),
      composite: row.composite,
      confidence: row.confidence,
      currentPrice: row.price,
      calib,
    });
  }, [row, horizonMin, calib]);

  if (!row) return null;

  const muSigned = `${row.mu >= 0 ? "↑" : "↓"} ${fmtBps(row.mu)}`;
  const muClass = row.mu >= 0 ? "text-primary" : "text-error";
  const sizing = recommendedSizing(row);
  const exchange = row.exchange ?? exchangeFor(row.symbol);
  const evidenceClass = row.evidence >= calib.evidenceThreshold ? "text-primary" : "text-on-surface-variant";

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label={`${row.symbol} detail`}
        className="fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-full flex-col border-l border-border bg-surface-low shadow-2xl transition-transform"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-border bg-surface-lowest px-5 py-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xl font-bold text-on-surface">{row.symbol}</span>
              <ExchangeChip exchange={exchange} />
              <DecisionBadge decision={row.decision} />
              <Badge tone={rolePillTone(row.role)} className="uppercase">
                {row.role}
              </Badge>
            </div>
            <div className="flex items-baseline gap-4 font-mono tabular-nums">
              <span className="text-2xl font-semibold text-on-surface">
                ${fmtPrice(row.price)}
              </span>
              <span className="text-xs text-on-surface-variant">
                conf {(row.confidence * 100).toFixed(0)}%
              </span>
              <span className={cn("text-xs", muClass)}>{muSigned}</span>
              <span className={cn("text-xs", evidenceClass)}>
                ev {row.evidence.toFixed(0)}/{calib.evidenceThreshold}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close detail drawer"
            className="rounded-sm border border-border bg-surface-low p-1.5 text-on-surface-variant transition hover:border-primary hover:text-primary"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* Scrollable body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Gate Waterfall */}
          <section className="space-y-3">
            <h4 className="label-caps">Gate Waterfall</h4>
            <GateWaterfall modelEdge={row.modelEdge} cost={row.cost} net={row.net} />
            <p className="font-mono text-[10px] leading-relaxed text-on-surface-variant">
              Aggregate cost wall shown; per-component (entry/exit/queue/op) breakdown
              not exposed on snapshot. Net = model edge − cost.
            </p>
          </section>

          {/* Composite */}
          <section className="space-y-3">
            <h4 className="label-caps">Composite Breakdown</h4>
            <CompositeBreakdown
              row={row}
              wM={calib.wMomentum}
              wQ={calib.wQuality}
              wL={calib.wLiquidity}
              wR={calib.wRisk}
            />
          </section>

          {/* Stop / Target / R:R */}
          {levels && (
            <section className="space-y-3">
              <h4 className="label-caps">Stop / Target / R:R</h4>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-sm border border-border bg-surface-lowest p-3">
                  <div className="label-caps text-[9px] text-on-surface-variant">Stop</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums text-error">
                    ${fmtPrice(levels.stop)}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-on-surface-variant tabular-nums">
                    −{(((row.price - levels.stop) / row.price) * 100).toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-sm border border-border bg-surface-lowest p-3">
                  <div className="label-caps text-[9px] text-on-surface-variant">Target</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums text-primary">
                    ${fmtPrice(levels.target)}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-on-surface-variant tabular-nums">
                    +{(((levels.target - row.price) / row.price) * 100).toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-sm border border-border bg-surface-lowest p-3">
                  <div className="label-caps text-[9px] text-on-surface-variant">R:R</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums text-on-surface">
                    {levels.rr.toFixed(2)}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-on-surface-variant tabular-nums">
                    min {calib.minRR.toFixed(1)}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Sparkline */}
          {history && history.length >= 2 && (
            <section className="space-y-2">
              <h4 className="label-caps">μ Trend ({history.length} samples)</h4>
              <MuSparkline history={history} />
            </section>
          )}

          {/* Primary Role Assignment */}
          <section className="space-y-3 rounded-md border border-border bg-surface-lowest p-4">
            <div className="flex items-center justify-between">
              <h4 className="label-caps">Role Assignment</h4>
              <Badge tone={rolePillTone(row.role)} className="uppercase">
                {row.role}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 font-mono text-[11px] tabular-nums">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-on-surface-variant">
                  Recommended Sizing
                </div>
                <div className="mt-1 text-lg font-semibold text-primary">{sizing.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-on-surface-variant">
                  pUp
                </div>
                <div className="mt-1 text-lg font-semibold text-on-surface">
                  {(row.pUp * 100).toFixed(1)}%
                </div>
              </div>
              {row.starScore != null && (
                <div className="col-span-2">
                  <div className="text-[9px] uppercase tracking-wider text-on-surface-variant">
                    Buy Rank Score
                  </div>
                  <div className="mt-1 text-lg font-semibold text-primary tabular-nums">
                    {row.starScore.toFixed(2)}
                    {row.star && <span className="ml-1.5 text-sm text-[#FFD700]">★</span>}
                  </div>
                </div>
              )}
            </div>
            <Button variant="primary" size="sm" disabled className="w-full">
              Execution wiring coming soon
            </Button>
          </section>
        </div>
      </aside>
    </>
  );
}

export default SymbolDetailDrawer;
