"use client";

import { ActionableDashboard } from "@/components/dashboard/views/ActionableDashboard";

// Single-view dashboard. Multi-view tabs (Live Terminal / Vertical Stream /
// Executive / Matrix / Watchlist / Heatmap / Signal Map) were removed at the
// user's direction — we surface only actionable picks + portfolio decisions.
// SPECLIST §29/§30/§57 alignment: the scanner shows what would change account
// state; anything else is noise.

export default function DashboardPage() {
  return <ActionableDashboard />;
}
