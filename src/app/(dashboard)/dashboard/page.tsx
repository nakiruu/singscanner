"use client";

import { useState } from "react";
import { ScanTabs, type ScanView } from "@/components/dashboard/ScanTabs";
import { SymbolDetailDrawer } from "@/components/dashboard/SymbolDetailDrawer";
import { ExecutiveDashboard } from "@/components/dashboard/views/ExecutiveDashboard";
import { HeatmapView } from "@/components/dashboard/views/HeatmapView";
import { LiveTerminal } from "@/components/dashboard/views/LiveTerminal";
import { MatrixGrid } from "@/components/dashboard/views/MatrixGrid";
import { VerticalStream } from "@/components/dashboard/views/VerticalStream";
import { WatchlistView } from "@/components/dashboard/views/WatchlistView";
import { useScanStream } from "@/lib/hooks/useScanStream";
import type { ScanRow } from "@/lib/engine/types";

export default function DashboardPage() {
  const [view, setView] = useState<ScanView>("live");
  const { snapshot, prevSnapshot, status, lastUpdate, history } = useScanStream();

  // Drawer state — shared across every view that wants to open it.
  const [drawerSymbol, setDrawerSymbol] = useState<string | null>(null);
  const drawerRow: ScanRow | null = drawerSymbol
    ? snapshot?.rows.find((r) => r.symbol === drawerSymbol) ?? null
    : null;
  const drawerHistory = drawerSymbol ? history.get(drawerSymbol) ?? [] : [];

  const openDrawer = (row: ScanRow) => setDrawerSymbol(row.symbol);
  const openDrawerBySymbol = (symbol: string) => setDrawerSymbol(symbol);

  return (
    <div className="flex flex-col">
      <ScanTabs value={view} onChange={setView} />
      <div className="pt-4">
        {view === "live" && (
          <LiveTerminal snapshot={snapshot} onSelectRow={openDrawer} />
        )}
        {view === "stream" && <VerticalStream snapshot={snapshot} />}
        {view === "exec" && (
          <ExecutiveDashboard
            snapshot={snapshot}
            prevSnapshot={prevSnapshot}
            status={status}
            lastUpdate={lastUpdate}
          />
        )}
        {view === "matrix" && <MatrixGrid snapshot={snapshot} />}
        {view === "watchlist" && <WatchlistView snapshot={snapshot} />}
        {view === "heatmap" && (
          <HeatmapView snapshot={snapshot} onSelectSymbol={openDrawerBySymbol} />
        )}
      </div>

      <SymbolDetailDrawer
        row={drawerRow}
        horizonSpec={snapshot?.horizon ?? "5d"}
        history={drawerHistory}
        onClose={() => setDrawerSymbol(null)}
      />
    </div>
  );
}
