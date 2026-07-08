// Shadow monitor bootstrap + fire-and-forget entry point.

import type { ScanSnapshot } from "@/lib/engine/types";
import { ShadowMonitor } from "./monitor";
import { runHistoricalBacklog, getBacklogProgress } from "./backlog";

export { getBacklogProgress, runHistoricalBacklog };

const HORIZONS = ["3d", "5d", "10d"] as const;
type Horizon = typeof HORIZONS[number];

// Next.js compiles instrumentation.ts and route handlers into separate
// bundles, each with its own copy of this module's top-level state. Anchor
// the singleton on globalThis so bootstrap (instrumentation) and consumers
// (scanner, admin routes) share the same monitors.
type ShadowState = {
  monitors: Map<Horizon, ShadowMonitor>;
  bootstrapped: boolean;
};
const globalShadow = globalThis as unknown as { __shadowState?: ShadowState };
const state: ShadowState = (globalShadow.__shadowState ??= {
  monitors: new Map(),
  bootstrapped: false,
});
const monitors = state.monitors;

export function bootstrapShadowMonitors(): void {
  if (state.bootstrapped) return;
  state.bootstrapped = true;
  if (process.env.SHADOW_ENABLED !== "true") {
    console.log("[shadow] SHADOW_ENABLED != 'true'; monitors disabled");
    return;
  }
  console.log(`[shadow] bootstrapping monitors: ${HORIZONS.join(", ")}`);
  for (const h of HORIZONS) {
    const m = new ShadowMonitor(h);
    monitors.set(h, m);
    // Init + backlog kickoff, fire-and-forget.
    void (async () => {
      try {
        await m.init();
        await runHistoricalBacklog(m);
      } catch (err) {
        console.warn(`[shadow] bootstrap failed for ${h}:`, err);
      }
    })();
  }

  // Graceful shutdown: flush challenger state on SIGTERM / SIGINT.
  const flushAll = async () => {
    for (const m of monitors.values()) await m.flushShutdown();
  };
  process.on("SIGTERM", () => { void flushAll(); });
  process.on("SIGINT", () => { void flushAll(); });
}

export function shadowMonitorAsync(snap: ScanSnapshot): void {
  const h = snap.horizon as Horizon;
  const m = monitors.get(h);
  if (!m) return;
  void m.observe(snap);
}

export function getMonitor(horizon: Horizon): ShadowMonitor | null {
  return monitors.get(horizon) ?? null;
}
