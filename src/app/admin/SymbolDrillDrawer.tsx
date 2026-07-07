"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SymbolHistoryResponse } from "@/app/api/admin/symbol/[symbol]/route";

interface Props {
  symbol: string;
  onClose: () => void;
}

export function SymbolDrillDrawer({ symbol, onClose }: Props) {
  const [data, setData] = useState<SymbolHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/admin/symbol/${encodeURIComponent(symbol)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const json = (await r.json()) as SymbolHistoryResponse;
        if (alive) setData(json);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "unknown");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [symbol]);

  const latest = data?.history?.[0];

  return (
    <div
      role="dialog"
      aria-label={`Symbol ${symbol}`}
      className="fixed right-0 top-16 z-50 flex h-[calc(100vh-4rem)] w-[360px] flex-col border-l border-border bg-surface-low shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-on-surface">{symbol}</span>
          {latest && (
            <>
              <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">{latest.role}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">·</span>
              <span className={cn(
                "font-mono text-[10px] uppercase tracking-wider",
                latest.decision === "BUY" ? "text-success" : "text-on-surface-variant",
              )}>{latest.decision}</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close symbol drawer"
          className="font-mono text-xs text-on-surface-variant hover:text-on-surface"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {loading && <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>}
        {error && <div className="font-mono text-[11px] text-error">error · {error}</div>}
        {data && !loading && (
          <>
            {latest && (
              <div className="mb-3 font-mono text-[11px] text-on-surface">
                current price · ${latest.price.toFixed(2)}
              </div>
            )}
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              Last {data.history.length} scans
            </div>
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="text-on-surface-variant">
                  <th className="text-left">time</th>
                  <th className="text-left">role</th>
                  <th className="text-right">net</th>
                  <th className="text-right">dec</th>
                  <th className="w-4"></th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((r, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="text-on-surface-variant">{r.generatedAt.slice(11, 19)}</td>
                    <td className="text-on-surface-variant">{r.role}</td>
                    <td className={cn(
                      "text-right",
                      r.net > 0 ? "text-success" : "text-on-surface-variant",
                    )}>{r.net > 0 ? "+" : ""}{r.net.toFixed(1)}</td>
                    <td className="text-right text-on-surface">{r.decision}</td>
                    <td className="text-tertiary">{r.star ? "★" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
