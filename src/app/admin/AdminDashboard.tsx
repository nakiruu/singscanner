"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSummaryPolling } from "./hooks/useSummaryPolling";
import { useAge } from "./hooks/useAge";
import { SignalQualitySection } from "./sections/SignalQualitySection";
import { ShadowSection } from "./sections/ShadowSection";
import { PipelineHealthSection } from "./sections/PipelineHealthSection";
import { BusinessSection } from "./sections/BusinessSection";
import { ActivityDrawer } from "./ActivityDrawer";
import { SymbolDrillDrawer } from "./SymbolDrillDrawer";

const DRAWER_STORAGE_KEY = "admin.activityDrawer";

export function AdminDashboard() {
  const { data, error, refreshedAt } = useSummaryPolling();
  const age = useAge(refreshedAt);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focusedSymbol, setFocusedSymbol] = useState<string | null>(null);
  // Hydrate from localStorage after mount to avoid SSR hydration mismatch.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(DRAWER_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v === "1") setDrawerOpen(true);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAWER_STORAGE_KEY, drawerOpen ? "1" : "0");
    } catch { /* ignore */ }
  }, [drawerOpen]);

  return (
    <main className="relative flex flex-1 flex-col px-6 py-8">
      <div className="mx-auto w-full max-w-[1280px] space-y-4">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-low px-5 py-3">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-on-surface">
              ◆ Admin Console
            </h1>
            <Badge tone="primary" led>ADMIN</Badge>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px] text-on-surface-variant">
            <span className={cn(
              "inline-flex items-center gap-1.5",
              error ? "text-error" : "text-success",
            )}>
              <span className={cn(
                "inline-block h-2 w-2 rounded-full",
                error ? "bg-error" : "bg-success",
              )} />
              {error ? `ERR · ${error}` : "LIVE"}
            </span>
            {age != null && <span>updated {age}s ago</span>}
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className={cn(
                "rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                drawerOpen
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface-lowest text-on-surface-variant hover:text-on-surface",
              )}
            >
              ◆ Activity
            </button>
          </div>
        </div>

        {/* Sections */}
        <SignalQualitySection signal={data?.signal ?? null} onSymbolClick={setFocusedSymbol} />
        <ShadowSection />
        <PipelineHealthSection pipeline={data?.pipeline ?? null} />
        <BusinessSection business={data?.business ?? null} />

      </div>
      <ActivityDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSymbolClick={setFocusedSymbol} />
      {focusedSymbol && (
        <SymbolDrillDrawer symbol={focusedSymbol} onClose={() => setFocusedSymbol(null)} />
      )}
    </main>
  );
}
