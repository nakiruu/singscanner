"use client";

import { useState } from "react";
import { ScanTabs, type ScanView } from "@/components/dashboard/ScanTabs";
import { ExecutiveDashboard } from "@/components/dashboard/views/ExecutiveDashboard";
import { LiveTerminal } from "@/components/dashboard/views/LiveTerminal";
import { MatrixGrid } from "@/components/dashboard/views/MatrixGrid";
import { VerticalStream } from "@/components/dashboard/views/VerticalStream";
import { useScanStream } from "@/lib/hooks/useScanStream";

export default function DashboardPage() {
  const [view, setView] = useState<ScanView>("live");
  const { snapshot } = useScanStream();

  return (
    <div className="flex flex-col">
      <ScanTabs value={view} onChange={setView} />
      <div className="pt-4">
        {view === "live" && <LiveTerminal snapshot={snapshot} />}
        {view === "stream" && <VerticalStream snapshot={snapshot} />}
        {view === "exec" && <ExecutiveDashboard snapshot={snapshot} />}
        {view === "matrix" && <MatrixGrid snapshot={snapshot} />}
      </div>
    </div>
  );
}
