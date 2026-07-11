"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSummary } from "@/app/api/admin/summary/route";

type Pipeline = AdminSummary["pipeline"];

export function PipelineHealthSection({ pipeline }: { pipeline: Pipeline | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>▸ Pipeline health</CardTitle>
        <span className="font-mono text-[10px] text-on-surface-variant">alpaca · ch · fund</span>
      </CardHeader>
      <CardContent>
        {!pipeline ? (
          <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Alpaca" value={`${(pipeline.alpacaSuccess1h * 100).toFixed(1)}%`} sub="1h success" />
              <Stat
                label="Cache hit"
                value={pipeline.fundamentalsCacheHit == null
                  ? "n/a"
                  : `${(pipeline.fundamentalsCacheHit * 100).toFixed(0)}%`}
                sub="fundamentals"
              />
              <Stat label="CH bars" value={fmtCount(pipeline.chBars24h)} sub="/24h" />
              <Stat label="CH rows" value={fmtCount(pipeline.chScanRows24h)} sub="scan_rows /24h" />
              <Stat label="Scan p95" value={`${pipeline.scanP95Ms.toFixed(0)}ms`} sub="build snapshot" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              {pipeline.trader.map((t) => (
                <Stat
                  key={t.horizon}
                  label={`Trader ${t.horizon}`}
                  value={t.lastCycleAgeS == null ? "off" : `${t.lastCycleAgeS}s`}
                  sub={`${t.entries1h}in ${t.exits1h}out ${t.errors1h}err /1h`}
                />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">{label}</div>
      <div className="font-mono text-lg font-semibold text-on-surface">{value}</div>
      <div className="font-mono text-[10px] text-on-surface-variant">{sub}</div>
    </div>
  );
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
