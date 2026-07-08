"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ShadowSummary } from "@/app/api/admin/shadow/summary/route";

const POLL_MS = 12_000;

export function ShadowSection() {
  const [data, setData] = useState<ShadowSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchOnce = async () => {
      try {
        const r = await fetch("/api/admin/shadow/summary", { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const json = (await r.json()) as ShadowSummary;
        if (!alive) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "unknown");
      }
    };
    fetchOnce();
    const t = setInterval(fetchOnce, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>▸ Shadow monitor · challenger vs baseline</CardTitle>
        <Link
          href="/admin/shadow"
          className="font-mono text-[10px] uppercase tracking-wider text-primary hover:underline"
        >
          open →
        </Link>
      </CardHeader>
      <CardContent>
        {error && <div className="font-mono text-[11px] text-error">error · {error}</div>}
        {!data ? (
          <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>
        ) : (
          <>
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="text-on-surface-variant">
                  <th className="text-left">horizon</th>
                  <th className="text-right">δ_post (live)</th>
                  <th className="text-right">n (live)</th>
                  <th className="text-right">pos%</th>
                  <th className="text-left pl-3">status</th>
                </tr>
              </thead>
              <tbody>
                {data.perHorizon.map((h) => (
                  <tr key={h.horizon} className="border-t border-border/50">
                    <td className="py-1 font-semibold text-on-surface">{h.horizon}</td>
                    <td className={cn(
                      "py-1 text-right tabular-nums",
                      h.posterior_live.delta_post_bps > 0 ? "text-success" : "text-error",
                    )}>
                      {h.posterior_live.delta_post_bps > 0 ? "+" : ""}
                      {h.posterior_live.delta_post_bps.toFixed(1)} bps
                    </td>
                    <td className="py-1 text-right tabular-nums text-on-surface">
                      {h.posterior_live.n_clean}
                    </td>
                    <td className="py-1 text-right tabular-nums text-on-surface-variant">
                      {Math.round(h.posterior_live.positive_share * 100)}%
                    </td>
                    <td className="py-1 pl-3">
                      <StatusPill posterior={h.posterior_live} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 font-mono text-[10px] text-on-surface-variant">
              historical:{" "}
              {data.perHorizon.reduce((a, h) => a + h.backlogSamples, 0)} samples ·{" "}
              biased posteriors excluded from promotion criterion
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({ posterior }: { posterior: { promotable: boolean; n_clean: number } }) {
  const label = posterior.promotable
    ? "promotable"
    : posterior.n_clean < 30
      ? `n<30`
      : "hold";
  const tone = posterior.promotable ? "text-success" : "text-on-surface-variant";
  return (
    <span className={cn("font-mono text-[10px] uppercase tracking-wider", tone)}>
      {label}
    </span>
  );
}
