"use client";

import { Badge } from "@/components/ui/badge";
import { DecisionBadge } from "@/components/dashboard/DecisionBadge";
import { ExchangeChip } from "@/components/dashboard/ExchangeChip";
import { GateBar } from "@/components/dashboard/GateBar";
import { MQLRBars } from "@/components/dashboard/MQLRBars";
import { StarButton } from "@/components/dashboard/StarButton";
import { useWatchlist } from "@/lib/hooks/useWatchlist";
import { exchangeFor } from "@/lib/ui-helpers";
import { cn } from "@/lib/utils";
import type { ScanRow, ScanSnapshot } from "@/lib/engine/types";

export interface WatchlistViewProps {
  snapshot: ScanSnapshot | null;
}

const HEADERS: ReadonlyArray<{ id: string; label: string; align?: "left" | "right" | "center" }> = [
  { id: "star", label: "", align: "left" },
  { id: "symbol", label: "Symbol", align: "left" },
  { id: "price", label: "Price", align: "right" },
  { id: "spread", label: "Spread", align: "right" },
  { id: "relvol", label: "Rel Vol", align: "right" },
  { id: "mqlr", label: "M·Q·L·R", align: "center" },
  { id: "conf", label: "Conf", align: "right" },
  { id: "mu", label: "μ bps", align: "right" },
  { id: "role", label: "Role", align: "left" },
  { id: "evid", label: "Evid", align: "right" },
  { id: "ml", label: "ML", align: "right" },
  { id: "gate", label: "Gate / Net Surplus", align: "left" },
  { id: "decision", label: "Decision", align: "left" },
];

function RoleBadge({ role }: { role: ScanRow["role"] }) {
  if (role === "primary") {
    return (
      <span className="inline-flex rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
        PRIMARY
      </span>
    );
  }
  if (role === "retained") {
    return (
      <span className="inline-flex rounded-sm border border-[#4F9DF0]/40 bg-[#4F9DF0]/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#4F9DF0]">
        RETAINED
      </span>
    );
  }
  if (role === "secondary") {
    return <Badge tone="neutral">SECONDARY</Badge>;
  }
  return <Badge tone="neutral">—</Badge>;
}

function muTone(mu: number): string {
  if (mu > 0.1) return "text-primary";
  if (mu < -0.1) return "text-error";
  return "text-tertiary";
}

export function WatchlistView({ snapshot }: WatchlistViewProps) {
  const { symbolSet, toggle, loading, error } = useWatchlist();
  const allRows = snapshot?.rows ?? [];
  const rows = allRows.filter((r) => symbolSet.has(r.symbol));

  const showEmpty = !loading && rows.length === 0;

  return (
    <div className="overflow-x-auto px-6 pb-6">
      {error && (
        <div className="mb-3 rounded border border-error/40 bg-error/10 px-3 py-2 font-mono text-xs text-error">
          {error}
        </div>
      )}
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
          {showEmpty && (
            <tr>
              <td
                colSpan={HEADERS.length}
                className="px-3 py-8 text-center font-mono text-xs text-terminal-gray"
              >
                <div className="space-y-1">
                  <div>Your watchlist is empty.</div>
                  <div className="text-on-surface-variant">
                    Star symbols from any view to add them here.
                  </div>
                </div>
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr
              key={row.symbol}
              className="border-b border-border/60 transition hover:bg-surface-low/50"
            >
              <td className="px-3 py-2">
                <StarButton
                  symbol={row.symbol}
                  starred={true}
                  onToggle={toggle}
                />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-on-surface">{row.symbol}</span>
                  <ExchangeChip exchange={exchangeFor(row.symbol)} />
                </div>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-on-surface">
                {row.price.toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-primary">
                {row.spreadBps > 0 ? `${(row.spreadBps / 100).toFixed(2)}%` : "—"}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-on-surface-variant">
                {row.relVol.toFixed(1)}x
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-center">
                  <MQLRBars
                    M={row.momentum}
                    Q={row.quality}
                    L={row.liquidity}
                    R={row.risk}
                  />
                </div>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-on-surface">
                {Math.round(row.confidence * 100)}%
              </td>
              <td className={cn("px-3 py-2 text-right font-mono tabular-nums", muTone(row.mu))}>
                {row.mu >= 0 ? "+" : ""}
                {row.mu.toFixed(1)}
              </td>
              <td className="px-3 py-2">
                <RoleBadge role={row.role} />
              </td>
              <td
                className={cn(
                  "px-3 py-2 text-right font-mono tabular-nums",
                  row.evidence >= 95 ? "text-on-surface" : "text-on-surface-variant",
                )}
              >
                {Math.round(row.evidence)}
              </td>
              <td
                className={cn(
                  "px-3 py-2 text-right font-mono tabular-nums",
                  row.mlScore != null && row.mlScore >= 60 ? "text-primary" : "text-error",
                )}
              >
                {row.mlScore != null ? `${Math.round(row.mlScore)}%` : "—"}
              </td>
              <td className="px-3 py-2">
                <GateBar
                  modelEdge={row.modelEdge}
                  required={row.cost}
                  net={row.net}
                />
              </td>
              <td className="px-3 py-2">
                <DecisionBadge decision={row.decision} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
