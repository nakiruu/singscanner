// Trader bootstrap + public read/event API (spec §6/§8). One TraderRunner per
// horizon that has paper credentials configured. Idempotent; silent no-op
// unless TRADER_ENABLED=true.

import { Broker, type AccountSnapshot, type OpenOrder, type PositionState } from "./broker";
import { TraderRunner, type PositionEvent, type TraderHorizon } from "./runner";
import { readTraderSettings, readExtendedSettings, readSessionSettings } from "./settings";

export type { PositionEvent, TraderHorizon } from "./runner";
export type { AccountSnapshot, OpenOrder, PositionState } from "./broker";

const HORIZONS: TraderHorizon[] = ["3d", "5d", "10d"];

// Next.js compiles instrumentation.ts and route handlers into SEPARATE
// bundles, each with its own copy of this module's top-level state. Anchor
// the singleton on globalThis so bootstrap (instrumentation) and consumers
// (admin routes, sub-project B) share the same runners. Verified failure
// mode 2026-07-08: the shadow monitors used plain module state and the API
// routes saw an empty map while bootstrap had populated its own copy.
type TraderState = {
  runners: Map<TraderHorizon, TraderRunner>;
  bootstrapped: boolean;
};
const globalTrader = globalThis as unknown as { __traderState?: TraderState };
const state: TraderState = (globalTrader.__traderState ??= {
  runners: new Map(),
  bootstrapped: false,
});
const runners = state.runners;

export function bootstrapTraders(): void {
  if (state.bootstrapped) return;
  state.bootstrapped = true;
  if (process.env.TRADER_ENABLED !== "true") {
    console.log("[trader] TRADER_ENABLED != 'true'; runners disabled");
    return;
  }
  const baseUrl = process.env.TRADER_ALPACA_PAPER_URL ?? "https://paper-api.alpaca.markets";
  const settings = readTraderSettings();
  const extendedSettings = readExtendedSettings();
  const sessionSettings = readSessionSettings();
  for (const horizon of HORIZONS) {
    const envKey = horizon.toUpperCase(); // "3D" | "5D" | "10D"
    const keyId = process.env[`TRADER_${envKey}_KEY_ID`];
    const secret = process.env[`TRADER_${envKey}_SECRET`];
    if (!keyId || !secret) {
      console.log(`[trader:${horizon}] no credentials — runner disabled`);
      continue;
    }
    try {
      const broker = new Broker({ keyId, secret, baseUrl });
      const runner = new TraderRunner({ horizon, broker, settings, extendedSettings, sessionSettings });
      runner.start();
      runners.set(horizon, runner);
    } catch (err) {
      console.error(`[trader:${horizon}] bootstrap failed:`, err);
    }
  }

  const shutdown = () => { for (const r of runners.values()) r.stop(); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function getRunner(horizon: TraderHorizon): TraderRunner | null {
  return runners.get(horizon) ?? null;
}

// -- Read API for sub-project B ------------------------------------------------

export interface Holding {
  symbol: string;
  qty: number;
  avgPrice: number;
  marketValue: number;
  currentPrice: number;
  unrealizedPl: number;
  unrealizedPlPct: number;
  positionPct: number;   // marketValue / equity
}

export async function getHoldings(horizon: TraderHorizon): Promise<Holding[]> {
  const r = runners.get(horizon);
  if (!r) return [];
  const equity = Math.max(1, r.getAccountSnapshot().equity);
  return r.getHoldings().map((p: PositionState) => ({
    symbol: p.symbol,
    qty: p.qty,
    avgPrice: p.avgPrice,
    marketValue: p.marketValue,
    currentPrice: p.currentPrice,
    unrealizedPl: p.unrealizedPl,
    unrealizedPlPct: p.unrealizedPlPct,
    positionPct: p.marketValue / equity,
  }));
}

export async function getOpenOrders(horizon: TraderHorizon): Promise<OpenOrder[]> {
  return runners.get(horizon)?.getOpenOrders() ?? [];
}

export async function getAccountSummary(
  horizon: TraderHorizon,
): Promise<(AccountSnapshot & { positionCount: number }) | null> {
  const r = runners.get(horizon);
  if (!r) return null;
  return { ...r.getAccountSnapshot(), positionCount: r.getHoldings().length };
}

// -- Event pub/sub for sub-project C --------------------------------------------

export function subscribeToPositionEvents(
  listener: (e: PositionEvent) => void,
): () => void {
  const unsubs = [...runners.values()].map((r) => r.onEvent(listener));
  return () => { for (const u of unsubs) u(); };
}
