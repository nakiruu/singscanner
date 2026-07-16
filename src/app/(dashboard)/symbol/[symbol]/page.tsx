// Symbol deep-dive.
//
// Full audit of a single symbol: gate decomposition, horizon ladder, shadow
// monitor bucket context, and a chart placeholder. Reads from the live
// scan stream — no new API surface required for Week 3. Replaces the
// SymbolDetailDrawer for cases where the user wants a bookmarkable /
// shareable link.

"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Star, StarOff, ExternalLink } from "lucide-react";
import { DecisionBadge } from "@/components/dashboard/DecisionBadge";
import { ConfidenceDots } from "@/components/dashboard/ConfidenceDots";
import { ExchangeChip } from "@/components/dashboard/ExchangeChip";
import { MQLRBars } from "@/components/dashboard/MQLRBars";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useScanStream } from "@/lib/hooks/useScanStream";
import { useWatchlist } from "@/lib/hooks/useWatchlist";
import { exchangeFor } from "@/lib/ui-helpers";
import { cn } from "@/lib/utils";
import type { ScanRow } from "@/lib/engine/types";

export default function SymbolDeepDive({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: rawSymbol } = use(params);
  const symbol = decodeURIComponent(rawSymbol).toUpperCase();

  const { snapshot, status } = useScanStream();
  const { symbolSet, toggle } = useWatchlist();
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    setWatched(symbolSet.has(symbol));
  }, [symbol, symbolSet]);

  const row = useMemo<ScanRow | null>(
    () => snapshot?.rows.find((r) => r.symbol === symbol) ?? null,
    [snapshot, symbol],
  );

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6 p-6">
      {/* Header + return + actions */}
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 font-mono text-[12px] text-on-surface-variant transition hover:text-on-surface"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Scanner
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              await toggle(symbol);
              setWatched((v) => !v);
            }}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 font-mono text-[11px] transition",
              watched
                ? "border-tertiary/50 bg-tertiary/10 text-tertiary"
                : "border-border text-on-surface-variant hover:border-primary hover:text-primary",
            )}
          >
            {watched ? <Star className="h-3.5 w-3.5 fill-current" /> : <StarOff className="h-3.5 w-3.5" />}
            {watched ? "Watching" : "Add to watchlist"}
          </button>
        </div>
      </div>

      {/* Identity strip */}
      <Card>
        <CardContent className="flex flex-wrap items-baseline gap-x-6 gap-y-3 pt-6">
          <div className="flex items-baseline gap-3">
            <h1 className="font-mono text-4xl font-bold tabular-nums text-on-surface">
              {symbol}
            </h1>
            <ExchangeChip exchange={exchangeFor(symbol)} />
          </div>
          {row ? (
            <>
              <div className="flex items-center gap-2">
                <DecisionBadge decision={row.decision} row={row} horizon={snapshot?.horizon} />
                <ConfidenceDots confidence={row.confidence} />
              </div>
              <span className="ml-auto font-mono text-2xl font-semibold tabular-nums text-on-surface">
                ${row.price.toFixed(2)}
              </span>
            </>
          ) : (
            <span className="font-mono text-[11px] text-on-surface-variant">
              {status === "connecting" ? "loading scan…" : "no live row for this symbol"}
            </span>
          )}
        </CardContent>
      </Card>

      {row && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Chart placeholder */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Price</CardTitle>
              <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                candle chart lands with Lightweight Charts wiring
              </span>
            </CardHeader>
            <CardContent>
              <div
                aria-hidden="true"
                className="flex h-48 items-center justify-center rounded border border-dashed border-border/60 bg-surface-low font-mono text-[11px] text-on-surface-variant"
              >
                Chart placeholder · target Lightweight Charts (12kb, canvas)
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-[12px]">
                <PriceStat label="Stop" value={row.stopPx > 0 ? `$${row.stopPx.toFixed(2)}` : "—"} tone="text-error" />
                <PriceStat label="Fair value" value={row.fairValueTargetPx > 0 ? `$${row.fairValueTargetPx.toFixed(2)}` : "—"} tone="text-primary" />
                <PriceStat label="Take profit" value={row.takeProfitLimitPx > 0 ? `$${row.takeProfitLimitPx.toFixed(2)}` : "—"} tone="text-primary" />
              </div>
            </CardContent>
          </Card>

          {/* Gate decomposition */}
          <Card>
            <CardHeader>
              <CardTitle>Gate decomposition</CardTitle>
              <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                after-cost = model edge − costs
              </span>
            </CardHeader>
            <CardContent className="space-y-2 font-mono text-[12px]">
              <GateRow label="Model edge" value={row.modelEdge} sign="+" tone="text-on-surface" />
              <div className="pl-3">
                <GateRow label="− Entry cost" value={row.cEntry} sign="−" tone="text-error/80" />
                <GateRow label="− Exit reserve" value={row.cExit} sign="−" tone="text-error/80" />
                <GateRow label="− Queue / stale" value={row.cQueue} sign="−" tone="text-error/80" />
                <GateRow label="− Action memory" value={row.cMemory} sign="−" tone="text-error/80" />
                <GateRow label="− Concentration" value={row.concentrationBps} sign="−" tone="text-error/80" />
              </div>
              <div className="border-t border-border pt-2">
                <GateRow
                  label="= Net edge"
                  value={row.net}
                  sign={row.net >= 0 ? "+" : ""}
                  tone={row.net >= 0 ? "text-success font-semibold" : "text-error font-semibold"}
                />
              </div>
            </CardContent>
          </Card>

          {/* Signal families */}
          <Card>
            <CardHeader>
              <CardTitle>Signal families</CardTitle>
              <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                cross-sectional percentile ranks · 0-100
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-center">
                <MQLRBars
                  M={row.momentum}
                  Q={row.quality}
                  L={row.liquidity}
                  R={row.risk}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[12px]">
                <FamilyRow label="Momentum" value={row.momentum} />
                <FamilyRow label="Quality" value={row.quality} />
                <FamilyRow label="Liquidity" value={row.liquidity} />
                <FamilyRow label="Risk" value={row.risk} />
              </div>
              <div className="border-t border-border pt-2 font-mono text-[12px]">
                <FamilyRow label="Composite" value={row.composite} />
                <FamilyRow label="P(up)" value={row.pUp * 100} unit="%" />
                <FamilyRow label="Evidence" value={row.evidence} unit="" />
              </div>
            </CardContent>
          </Card>

          {/* Horizon ladder */}
          <Card>
            <CardHeader>
              <CardTitle>Horizon ladder</CardTitle>
              <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                same forecast · four horizons
              </span>
            </CardHeader>
            <CardContent>
              {row.horizonLadder.length === 0 ? (
                <span className="font-mono text-[11px] text-on-surface-variant">
                  no ladder data available
                </span>
              ) : (
                <ul className="space-y-1 font-mono text-[12px]">
                  {row.horizonLadder.map((rung) => {
                    const upsidePct = row.price > 0 ? ((rung.fairValueTarget - row.price) / row.price) * 100 : 0;
                    return (
                      <li
                        key={rung.horizonSpec}
                        className="flex items-baseline justify-between border-b border-border/50 py-1 last:border-b-0"
                      >
                        <span className="text-on-surface-variant">{rung.horizonSpec}</span>
                        <span className="tabular-nums text-on-surface">
                          ${rung.fairValueTarget.toFixed(2)}
                        </span>
                        <span
                          className={cn(
                            "tabular-nums",
                            upsidePct > 0 ? "text-success" : "text-error",
                          )}
                        >
                          {upsidePct > 0 ? "+" : ""}
                          {upsidePct.toFixed(2)}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Shadow monitor context */}
          <Card>
            <CardHeader>
              <CardTitle>Shadow monitor context</CardTitle>
              <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                per-symbol posterior lands with the promotion-guard wiring
              </span>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-[11px] text-on-surface-variant">
                The shadow monitor reasons per-bucket (role × session), not
                per-symbol. Per-symbol A/B tracking arrives with the
                promotion-guard wiring (P1a #5) — for now, this row&apos;s
                bucket-level posterior is visible in{" "}
                <Link
                  href="/admin/shadow"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Admin › Shadow
                  <ExternalLink className="h-3 w-3" />
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// -- Sub-components ----------------------------------------------------------

function PriceStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded border border-border bg-surface-low p-3">
      <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">
        {label}
      </div>
      <div className={cn("mt-1 tabular-nums", tone)}>{value}</div>
    </div>
  );
}

function GateRow({
  label,
  value,
  sign,
  tone,
}: {
  label: string;
  value: number;
  sign: string;
  tone: string;
}) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className={cn("text-on-surface-variant", tone)}>{label}</span>
      <span className={cn("tabular-nums", tone)}>
        {sign}
        {Math.abs(value).toFixed(1)} bps
      </span>
    </div>
  );
}

function FamilyRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-on-surface-variant">{label}</span>
      <span className="tabular-nums text-on-surface">
        {value.toFixed(1)}
        {unit ?? ""}
      </span>
    </div>
  );
}
