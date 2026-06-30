"use client";

import { Rocket, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DecisionBadge } from "@/components/dashboard/DecisionBadge";
import { ExchangeChip } from "@/components/dashboard/ExchangeChip";
import { MQLRBars } from "@/components/dashboard/MQLRBars";
import {
  exchangeFor,
  liquidityPassPct,
  momentumPassPct,
  recommendedSizing,
} from "@/lib/ui-helpers";
import { cn } from "@/lib/utils";
import type { ScanRow, ScanSnapshot } from "@/lib/engine/types";

export interface VerticalStreamProps {
  snapshot: ScanSnapshot | null;
}

function OpportunityCard({
  row,
  selected,
  onClick,
}: {
  row: ScanRow;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[1.4fr_1fr_1fr_0.7fr_0.7fr] items-center gap-3 border-l-2 px-4 py-3 text-left transition",
        selected
          ? "border-primary bg-primary/5"
          : "border-transparent hover:bg-surface-low/50"
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-base font-semibold text-on-surface">{row.symbol}</span>
          <ExchangeChip exchange={exchangeFor(row.symbol) === "NAS" ? "NASDAQ" : "NYSE"} />
        </div>
      </div>
      <div className="flex flex-col items-end">
        <span className="font-mono text-sm tabular-nums text-on-surface">
          {row.price.toFixed(2)}
        </span>
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            row.mu >= 0 ? "text-primary" : "text-error"
          )}
        >
          {row.mu >= 0 ? "+" : ""}
          {row.mu.toFixed(1)} bps
        </span>
      </div>
      <div className="flex justify-center">
        <MQLRBars M={row.momentum} Q={row.quality} L={row.liquidity} R={row.risk} />
      </div>
      <div className="text-right font-mono text-sm tabular-nums text-on-surface">
        {Math.round(row.confidence * 100)}%
      </div>
      <div className="flex justify-end">
        <DecisionBadge decision={row.decision} />
      </div>
    </button>
  );
}

function PassBar({ label, pct }: { label: string; pct: number }) {
  const pass = pct >= 50;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between font-mono text-xs">
        <span className="text-on-surface-variant">{label}</span>
        <span className={cn("font-semibold", pass ? "text-primary" : "text-error")}>
          {pass ? "PASS" : "FAIL"} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-sm bg-surface-low">
        <div
          className={cn("h-full", pass ? "bg-primary" : "bg-error")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function DeepInsight({ row, onClose }: { row: ScanRow; onClose: () => void }) {
  const sizing = recommendedSizing(row);
  const momPct = momentumPassPct(row);
  const liqPct = liquidityPassPct(row);

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface-lowest/40">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="label-caps">DEEP INSIGHT: {row.symbol}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close deep insight"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-on-surface-variant hover:bg-surface-low hover:text-on-surface"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-6 p-5">
        <div className="space-y-3">
          <div className="label-caps">Gate Waterfall</div>
          <PassBar label="Momentum Gate" pct={momPct} />
          <PassBar label="Liquidity Floor" pct={liqPct} />
        </div>

        <div className="rounded-lg border border-border bg-surface-low/40 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15">
              <Rocket className="h-4 w-4 text-primary" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-on-surface">
                {row.role === "primary" ? "Primary" : row.role === "secondary" ? "Secondary" : "Retained"} Role Assignment
              </span>
              <span className="font-mono text-xs text-on-surface-variant">
                Recommended sizing: {sizing.toFixed(1)}%
              </span>
            </div>
          </div>
          <Button variant="primary" className="mt-4 w-full">
            Initialize Execution
          </Button>
        </div>
      </div>
    </div>
  );
}

export function VerticalStream({ snapshot }: VerticalStreamProps) {
  const opportunities = useMemo(
    () =>
      (snapshot?.rows ?? [])
        .filter((r) => r.decision === "BUY" || r.decision === "WAIT")
        .slice(0, 12),
    [snapshot]
  );

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const selected =
    opportunities.find((r) => r.symbol === selectedSymbol) ?? opportunities[0] ?? null;

  return (
    <div className="grid grid-cols-1 gap-0 px-6 pb-6 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-1 py-3">
          <div className="flex items-center gap-2">
            <span className="led-pulse h-2 w-2 rounded-full bg-primary" />
            <span className="label-caps">Live Opportunities</span>
          </div>
          <span className="label-caps">
            COUNT: {String(opportunities.length).padStart(2, "0")} ACTIVE
          </span>
        </div>

        <div className="grid grid-cols-[1.4fr_1fr_1fr_0.7fr_0.7fr] gap-3 border-b border-border px-4 py-2">
          <span className="label-caps">Symbol</span>
          <span className="label-caps text-right">Price</span>
          <span className="label-caps text-center">M·Q·L·R</span>
          <span className="label-caps text-right">Conf</span>
          <span className="label-caps text-right">Decision</span>
        </div>

        <div className="divide-y divide-border/60">
          {opportunities.map((row) => (
            <OpportunityCard
              key={row.symbol}
              row={row}
              selected={selected?.symbol === row.symbol}
              onClick={() => setSelectedSymbol(row.symbol)}
            />
          ))}
          {opportunities.length === 0 && (
            <p className="px-4 py-6 font-mono text-xs text-terminal-gray">
              No actionable opportunities right now.
            </p>
          )}
        </div>
      </div>

      {selected ? (
        <DeepInsight row={selected} onClose={() => setSelectedSymbol(null)} />
      ) : (
        <div className="flex h-full items-center justify-center border-l border-border p-6 font-mono text-xs text-terminal-gray">
          Select a symbol to inspect.
        </div>
      )}
    </div>
  );
}
