"use client";

import { DecisionBadge } from "@/components/dashboard/DecisionBadge";
import { ExchangeChip } from "@/components/dashboard/ExchangeChip";
import { MQLRBars } from "@/components/dashboard/MQLRBars";
import { exchangeFor, gateFillPct, gateOverflowPct } from "@/lib/ui-helpers";
import { cn } from "@/lib/utils";
import type { ScanRow, ScanSnapshot } from "@/lib/engine/types";

export interface MatrixGridProps {
  snapshot: ScanSnapshot | null;
}

function MatrixCard({ row, rank }: { row: ScanRow; rank: number }) {
  const fillPct = gateFillPct(row);
  const overflow = gateOverflowPct(row);
  const positive = overflow >= 0;

  return (
    <div className="rounded-lg border border-border bg-surface-low/40 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-base font-semibold text-on-surface">{row.symbol}</span>
          <ExchangeChip exchange={exchangeFor(row.symbol)} />
        </div>
        <DecisionBadge decision={row.decision} />
      </div>

      <div className="mt-1 font-mono text-xs text-terminal-gray">
        #{String(rank).padStart(2, "0")}
      </div>

      <div className="mt-4 space-y-1">
        <div className="flex items-center justify-between font-mono text-xs">
          <span className="label-caps">Gate Surplus</span>
          <span className="tabular-nums text-on-surface-variant">
            {Math.round(Math.min(100, fillPct))}%
            <span className="mx-1 text-border">|</span>
            <span className={cn(positive ? "text-primary" : "text-error")}>
              {positive ? "+" : ""}
              {Math.round(overflow)}%
            </span>
          </span>
        </div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-sm bg-surface-low">
          <div
            className={cn("h-full", positive ? "bg-primary" : "bg-error")}
            style={{ width: `${Math.min(100, Math.max(8, fillPct))}%` }}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="label-caps">Price</div>
          <div className="font-mono text-sm tabular-nums text-on-surface">
            {row.price.toFixed(2)}
          </div>
        </div>
        <div className="text-right">
          <div className="label-caps">Conf</div>
          <div className="font-mono text-sm tabular-nums text-on-surface">
            {Math.round(row.confidence * 100)}%
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-start">
        <MQLRBars
          M={row.momentum}
          Q={row.quality}
          L={row.liquidity}
          R={row.risk}
          size="md"
        />
      </div>
    </div>
  );
}

export function MatrixGrid({ snapshot }: MatrixGridProps) {
  const rows = (snapshot?.rows ?? []).slice(0, 12);

  return (
    <div className="px-6 pb-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row, i) => (
          <MatrixCard key={row.symbol} row={row} rank={i + 1} />
        ))}
        {rows.length === 0 && (
          <p className="font-mono text-xs text-terminal-gray">No data yet.</p>
        )}
      </div>
    </div>
  );
}
