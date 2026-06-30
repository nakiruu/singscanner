"use client";

import { BarChart3, LayoutGrid, Megaphone, Newspaper } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { decisionTone } from "@/lib/ui-helpers";
import type { Decision, ScanSnapshot } from "@/lib/engine/types";

export interface ExecutiveDashboardProps {
  snapshot: ScanSnapshot | null;
}

function KpiCard({
  label,
  value,
  suffix,
  Icon,
}: {
  label: string;
  value: string;
  suffix?: string;
  Icon: typeof BarChart3;
}) {
  return (
    <Card>
      <CardHeader>
        <span className="label-caps">{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-3xl font-semibold tabular-nums text-primary">
            {value}
          </span>
          {suffix && (
            <span className="font-mono text-sm text-on-surface-variant">{suffix}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const DECISION_CHIP: Record<Decision, string> = {
  BUY: "border-primary/40 bg-primary/15 text-primary",
  WAIT: "border-tertiary/40 bg-tertiary/15 text-tertiary",
  HOLD: "border-[#4F9DF0]/40 bg-[#4F9DF0]/15 text-[#4F9DF0]",
  "HOLD-CASH": "border-[#4F9DF0]/40 bg-[#4F9DF0]/15 text-[#4F9DF0]",
  SELL: "border-error/40 bg-error/15 text-error",
};

const DECISION_TEXT: Record<Decision, string> = {
  BUY: "text-primary",
  WAIT: "text-tertiary",
  HOLD: "text-[#4F9DF0]",
  "HOLD-CASH": "text-[#4F9DF0]",
  SELL: "text-error",
};

export function ExecutiveDashboard({ snapshot }: ExecutiveDashboardProps) {
  const rows = snapshot?.rows ?? [];
  const total = snapshot?.symbolsScanned ?? 0;
  const actionable = rows.filter(
    (r) => r.decision === "BUY" || r.decision === "WAIT"
  ).length;

  const priority = [...rows].sort((a, b) => b.net - a.net).slice(0, 8);
  const recent = [...rows]
    .sort((a, b) => b.evidence - a.evidence)
    .slice(0, 8);

  return (
    <div className="space-y-6 px-6 pb-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard label="Engine Health" value="99.8" suffix="%" Icon={BarChart3} />
        <KpiCard label="Total Symbols" value={total.toLocaleString()} Icon={Newspaper} />
        <KpiCard
          label="Actionable Signals"
          value={String(actionable)}
          Icon={Megaphone}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <span className="label-caps flex items-center gap-2">
              <LayoutGrid className="h-3.5 w-3.5" />
              Priority Matrix
            </span>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2">
              {priority.map((row) => (
                <div
                  key={row.symbol}
                  className={cn(
                    "rounded-md border px-3 py-3 text-center font-mono text-xs font-semibold uppercase tracking-wider",
                    DECISION_CHIP[row.decision]
                  )}
                  title={`${row.symbol} · ${row.decision} · ${row.net.toFixed(1)} bps`}
                >
                  {row.symbol}
                </div>
              ))}
              {priority.length === 0 &&
                Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 rounded-md border border-dashed border-border bg-surface-low/40"
                  />
                ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <span className="label-caps flex items-center gap-2">
              <Newspaper className="h-3.5 w-3.5" />
              Recent Signals
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            {recent.length === 0 && (
              <p className="font-mono text-xs text-terminal-gray">No signals yet.</p>
            )}
            {recent.map((row) => (
              <div
                key={row.symbol}
                className="flex items-center justify-between border-b border-border/40 py-1.5 last:border-0"
              >
                <span className="font-mono text-sm font-semibold text-on-surface">
                  {row.symbol}
                </span>
                <span
                  className={cn(
                    "font-mono text-xs font-semibold uppercase tracking-wider",
                    DECISION_TEXT[row.decision]
                  )}
                >
                  {row.decision}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
