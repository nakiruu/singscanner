"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ShadowDetail } from "@/app/api/admin/shadow/[horizon]/route";

const HORIZONS = ["3d", "5d", "10d"] as const;
type Horizon = typeof HORIZONS[number];

export function ShadowClient() {
  const [horizon, setHorizon] = useState<Horizon>("3d");
  const [data, setData] = useState<ShadowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backlogBusy, setBacklogBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/admin/shadow/${horizon}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const json = (await r.json()) as ShadowDetail;
        if (!alive) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "unknown");
      } finally {
        if (alive) setLoading(false);
      }
    };
    void fetchData();
    return () => { alive = false; };
  }, [horizon]);

  const triggerBacklog = async (force: boolean) => {
    setBacklogBusy(true);
    try {
      await fetch("/api/admin/shadow/backlog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ horizon, force }),
      });
    } finally {
      setBacklogBusy(false);
    }
  };

  return (
    <main className="relative flex flex-1 flex-col px-6 py-8">
      <div className="mx-auto w-full max-w-[1280px] space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-low px-5 py-3">
          <div className="flex items-baseline gap-3">
            <Link href="/admin" className="font-mono text-[11px] text-on-surface-variant hover:text-on-surface">
              ← admin
            </Link>
            <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-on-surface">
              ◆ Shadow monitor
            </h1>
          </div>
          <div className="inline-flex items-center rounded-md border border-border bg-surface-lowest p-0.5">
            {HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={cn(
                  "rounded px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors",
                  h === horizon
                    ? "bg-surface-high text-on-surface"
                    : "text-on-surface-variant hover:bg-surface-low hover:text-on-surface",
                )}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <Card>
            <CardContent>
              <div className="font-mono text-[11px] text-error">error · {error}</div>
            </CardContent>
          </Card>
        )}

        {loading && !error && (
          <Card>
            <CardContent>
              <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>
            </CardContent>
          </Card>
        )}

        {data && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>▸ Posterior (live)</CardTitle></CardHeader>
              <CardContent>
                <PosteriorTable p={data.posterior_live} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>▸ Posterior (live + historical, biased)</CardTitle>
              </CardHeader>
              <CardContent>
                <PosteriorTable p={data.posterior_all} />
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader><CardTitle>▸ Buckets</CardTitle></CardHeader>
              <CardContent>
                {data.buckets.length === 0 ? (
                  <div className="font-mono text-[11px] text-on-surface-variant">no buckets yet</div>
                ) : (
                  <table className="w-full font-mono text-[11px]">
                    <thead>
                      <tr className="text-on-surface-variant">
                        <th className="text-left">bucket</th>
                        <th className="text-right">n</th>
                        <th className="text-right">mean_y</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.buckets.map((b) => (
                        <tr key={b.bucket} className="border-t border-border/50">
                          <td className="py-1 text-on-surface">{b.bucket}</td>
                          <td className="py-1 text-right tabular-nums">{b.n}</td>
                          <td className="py-1 text-right tabular-nums text-on-surface-variant">
                            {b.mean_y_bps.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>▸ Recent pending</CardTitle></CardHeader>
              <CardContent>
                {data.pending.length === 0 ? (
                  <div className="font-mono text-[11px] text-on-surface-variant">quiet</div>
                ) : (
                  <table className="w-full font-mono text-[11px]">
                    <thead>
                      <tr className="text-on-surface-variant">
                        <th className="text-left">sym</th>
                        <th className="text-left">base → chal</th>
                        <th className="text-right">Δnet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.pending.map((p, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="py-1 text-on-surface font-semibold">{p.symbol}</td>
                          <td className="py-1 text-on-surface-variant">
                            {p.baselineDecision} → {p.challengerDecision}
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {(p.challengerNetBps - p.baselineNetBps).toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>▸ Recent resolved (live)</CardTitle></CardHeader>
              <CardContent>
                {data.resolved.length === 0 ? (
                  <div className="font-mono text-[11px] text-on-surface-variant">none yet</div>
                ) : (
                  <table className="w-full font-mono text-[11px]">
                    <thead>
                      <tr className="text-on-surface-variant">
                        <th className="text-left">sym</th>
                        <th className="text-right">δ</th>
                        <th className="text-right">realized</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.resolved.map((r, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="py-1 text-on-surface font-semibold">{r.symbol}</td>
                          <td className={cn(
                            "py-1 text-right tabular-nums",
                            r.delta_bps > 0 ? "text-success" : "text-error",
                          )}>{r.delta_bps > 0 ? "+" : ""}{r.delta_bps.toFixed(1)}</td>
                          <td className="py-1 text-right tabular-nums text-on-surface-variant">
                            {r.realized_bps.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>▸ Backlog</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={backlogBusy}
                    onClick={() => triggerBacklog(false)}
                    className="rounded border border-border bg-surface-lowest px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant hover:text-on-surface disabled:opacity-50"
                  >
                    Run backlog (idempotent)
                  </button>
                  <button
                    type="button"
                    disabled={backlogBusy}
                    onClick={() => triggerBacklog(true)}
                    className="rounded border border-error bg-surface-lowest px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-error hover:brightness-110 disabled:opacity-50"
                  >
                    Force re-seed
                  </button>
                </div>
                <div className="mt-3 font-mono text-[10px] text-on-surface-variant">
                  historical daily δ: {data.historicalDailyDelta.length} days recorded
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}

function PosteriorTable({ p }: { p: ShadowDetail["posterior_live"] }) {
  return (
    <dl className="grid grid-cols-2 gap-y-1 font-mono text-[11px]">
      <dt className="text-on-surface-variant">n_clean</dt>
      <dd className="text-right tabular-nums">{p.n_clean}</dd>
      <dt className="text-on-surface-variant">mean δ</dt>
      <dd className="text-right tabular-nums">{p.mean_delta_bps.toFixed(1)} bps</dd>
      <dt className="text-on-surface-variant">positive share</dt>
      <dd className="text-right tabular-nums">{Math.round(p.positive_share * 100)}%</dd>
      <dt className="text-on-surface-variant">δ_post</dt>
      <dd className={cn(
        "text-right tabular-nums",
        p.delta_post_bps > 0 ? "text-success" : "text-error",
      )}>
        {p.delta_post_bps > 0 ? "+" : ""}{p.delta_post_bps.toFixed(2)} bps
      </dd>
      <dt className="text-on-surface-variant">promotable</dt>
      <dd className="text-right">{p.promotable ? "yes" : "no"}</dd>
      <dt className="col-span-2 mt-1 text-on-surface-variant">{p.reason}</dt>
    </dl>
  );
}
