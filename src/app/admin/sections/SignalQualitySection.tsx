"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSummary } from "@/app/api/admin/summary/route";

type Signal = AdminSummary["signal"];

export function SignalQualitySection({
  signal,
  onSymbolClick,
}: {
  signal: Signal | null;
  onSymbolClick?: (symbol: string) => void;
}) {
  if (!signal) {
    return <SectionCard title="Signal quality" subtitle="loading…"><Loading /></SectionCard>;
  }
  const { roleSplit, pupHistogram, topStars } = signal;
  const total = roleSplit.primary + roleSplit.secondary + roleSplit.none + roleSplit.retained;
  const maxHist = Math.max(1, ...pupHistogram.map((p) => p.n));

  return (
    <SectionCard
      title="Signal quality"
      subtitle={signal.latestSnapshotAt
        ? `latest ${signal.latestSnapshotAt.slice(11, 19)}`
        : "no scans yet"}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Left: role split + pUp histogram */}
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            Roles · {total} symbols
          </div>
          <div className="mb-1 flex items-baseline gap-2 font-mono text-sm">
            <span className="text-on-surface font-semibold">{roleSplit.primary}</span>
            <span className="text-[11px] text-on-surface-variant">primary</span>
            <span className="text-on-surface-variant">·</span>
            <span className="text-on-surface font-semibold">{roleSplit.secondary}</span>
            <span className="text-[11px] text-on-surface-variant">secondary</span>
            <span className="text-on-surface-variant">·</span>
            <span className="text-[11px] text-on-surface-variant">{roleSplit.none} none</span>
          </div>

          <div className="mt-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              pUp distribution · primary only
            </div>
            <div className="flex h-10 items-end gap-[1px]">
              {pupHistogram.map((b) => {
                const h = (b.n / maxHist) * 100;
                return (
                  <div
                    key={b.bucket}
                    title={`pUp ${b.bucket.toFixed(2)} · ${b.n} rows`}
                    style={{ height: `${Math.max(4, h)}%` }}
                    className={cn(
                      "flex-1 border-t",
                      h > 60 ? "bg-success border-success" : "bg-success/50 border-success/70",
                    )}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: top 5 stars */}
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            Top 5 stars
          </div>
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="text-on-surface-variant">
                <th className="w-4"></th>
                <th className="text-left">sym</th>
                <th className="text-left">role</th>
                <th className="text-right">net</th>
                <th className="text-right">pUp</th>
              </tr>
            </thead>
            <tbody>
              {topStars.length === 0 ? (
                <tr><td colSpan={5} className="py-2 text-on-surface-variant">no stars yet</td></tr>
              ) : topStars.map((s) => (
                <tr
                  key={s.symbol}
                  className="cursor-pointer border-t border-border/50 hover:bg-surface-default"
                  onClick={() => onSymbolClick?.(s.symbol)}
                >
                  <td className="text-tertiary">★</td>
                  <td className="text-on-surface font-semibold">{s.symbol}</td>
                  <td className="text-on-surface-variant">{s.role}</td>
                  <td className="text-right text-success">+{s.net.toFixed(1)}</td>
                  <td className="text-right text-on-surface-variant">{s.pUp.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}

// -- Small shared shell -------------------------------------------------------

function SectionCard({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>▸ {title}</CardTitle>
        {subtitle && <span className="font-mono text-[10px] text-on-surface-variant">{subtitle}</span>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Loading() {
  return <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>;
}
