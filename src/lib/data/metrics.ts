// In-memory instrumentation for the admin dashboard. Small ring buffers,
// no side effects outside this module. Callers wire recording; the admin
// summary API reads. See docs/superpowers/specs/2026-07-07-admin-dashboard-design.md.

import { randomUUID } from "crypto";
import type { MarketPhase } from "@/lib/data/clock";

// -- Alpaca fetch outcomes ---------------------------------------------------

const ALPACA_BUF_SIZE = 500;
interface AlpacaSample { ok: boolean; ts: number }
const alpacaBuf: AlpacaSample[] = [];

export function recordAlpacaFetch(ok: boolean): void {
  alpacaBuf.push({ ok, ts: Date.now() });
  if (alpacaBuf.length > ALPACA_BUF_SIZE) alpacaBuf.shift();
}

// Rolling success rate over the last `windowMs`. Returns 1.0 when there is
// no data so the dashboard doesn't show a bogus 0% before any calls happen.
export function getAlpacaSuccessRate(windowMs = 3_600_000): number {
  if (alpacaBuf.length === 0) return 1;
  const cutoff = Date.now() - windowMs;
  const recent = alpacaBuf.filter((s) => s.ts >= cutoff);
  if (recent.length === 0) return 1;
  const ok = recent.filter((s) => s.ok).length;
  return ok / recent.length;
}

// -- Scan durations ----------------------------------------------------------

const SCAN_BUF_SIZE = 200;
const scanDurations: number[] = [];

export function recordScanDuration(ms: number): void {
  scanDurations.push(ms);
  if (scanDurations.length > SCAN_BUF_SIZE) scanDurations.shift();
}

// p95 over the current buffer; 0 when empty.
export function getScanLatencyP95(): number {
  if (scanDurations.length === 0) return 0;
  const sorted = [...scanDurations].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// -- Errors ------------------------------------------------------------------

const ERR_BUF_SIZE = 200;
export type MetricsErrorKind = "alpaca" | "ch" | "fundamentals";
export interface MetricsError {
  id: string;
  kind: MetricsErrorKind;
  message: string;
  stack?: string;
  ts: number;
}
const errBuf: MetricsError[] = [];
const errIndex = new Map<string, MetricsError>();

export function recordError(e: {
  kind: MetricsErrorKind;
  message: string;
  stack?: string;
}): void {
  const rec: MetricsError = {
    id: randomUUID(),
    kind: e.kind,
    message: e.message,
    stack: e.stack,
    ts: Date.now(),
  };
  errBuf.push(rec);
  errIndex.set(rec.id, rec);
  if (errBuf.length > ERR_BUF_SIZE) {
    const dropped = errBuf.shift();
    if (dropped) errIndex.delete(dropped.id);
  }
}

export function getErrors(limit = 50): MetricsError[] {
  return errBuf.slice(-limit).reverse();
}

export function getErrorDetail(id: string): MetricsError | null {
  return errIndex.get(id) ?? null;
}

// -- Trader cycles (sub-project A) --------------------------------------------
// IMPORTANT: all trader metric state below is anchored on globalThis. The
// runner records from the instrumentation bundle while the scanner and admin
// routes read from route-handler bundles — Next.js gives each bundle its OWN
// module instance, so plain module-level Maps would never be visible to
// readers. (Verified failure mode 2026-07-08 in the shadow monitors.)

interface TraderCycleSample { ts: number; durationMs: number; entries: number; exits: number; errors: number }
const CYCLE_BUF_SIZE = 300;

type TraderMetricsState = {
  cycleBufs: Map<string, TraderCycleSample[]>;
  slipBufs: Map<string, number[]>;
  lastExitTs: Map<string, number>;
};
const globalTraderMetrics = globalThis as unknown as { __traderMetrics?: TraderMetricsState };
const traderMetrics: TraderMetricsState = (globalTraderMetrics.__traderMetrics ??= {
  cycleBufs: new Map(),
  slipBufs: new Map(),
  lastExitTs: new Map(),
});
const { cycleBufs, slipBufs, lastExitTs } = traderMetrics;

export function recordTraderCycle(
  horizon: string, durationMs: number, entries: number, exits: number, errors: number,
): void {
  let buf = cycleBufs.get(horizon);
  if (!buf) { buf = []; cycleBufs.set(horizon, buf); }
  buf.push({ ts: Date.now(), durationMs, entries, exits, errors });
  if (buf.length > CYCLE_BUF_SIZE) buf.shift();
}

export function getTraderCycleStats(horizon: string): {
  lastCycleAt: number | null; entries1h: number; exits1h: number; errors1h: number;
} {
  const buf = cycleBufs.get(horizon) ?? [];
  const cutoff = Date.now() - 3_600_000;
  const recent = buf.filter((s) => s.ts >= cutoff);
  return {
    lastCycleAt: buf.length ? buf[buf.length - 1].ts : null,
    entries1h: recent.reduce((a, s) => a + s.entries, 0),
    exits1h: recent.reduce((a, s) => a + s.exits, 0),
    errors1h: recent.reduce((a, s) => a + s.errors, 0),
  };
}

// -- Realized slippage feedback (spec §10) -------------------------------------
// Rolling window of 100 samples per (symbol, side, session). Below 5 samples
// the conservative default applies: 15 bps regular, 45 bps otherwise.

const SLIP_WINDOW = 100;
const SLIP_MIN_SAMPLES = 5;

function slipKey(symbol: string, side: "buy" | "sell", session: MarketPhase): string {
  return `${symbol}|${side}|${session}`;
}

export function recordSlippage(
  symbol: string, side: "buy" | "sell", session: MarketPhase, slipBps: number,
): void {
  if (!Number.isFinite(slipBps)) return;
  const key = slipKey(symbol, side, session);
  let buf = slipBufs.get(key);
  if (!buf) { buf = []; slipBufs.set(key, buf); }
  buf.push(Math.max(0, slipBps));
  if (buf.length > SLIP_WINDOW) buf.shift();
}

export function getExpectedSlippageBps(
  symbol: string, side: "buy" | "sell", session: MarketPhase,
): number {
  const buf = slipBufs.get(slipKey(symbol, side, session));
  if (buf && buf.length >= SLIP_MIN_SAMPLES) {
    return buf.reduce((a, b) => a + b, 0) / buf.length;
  }
  return session === "regular" ? 15 : 45;
}

// -- Action memory (spec §10 / gate.ts actionMemoryBps) -------------------------
// Per-symbol timestamp of the last trader exit. Cost decays linearly over the
// edge horizon: 2 × expected slippage × max(0, 1 − ageMin/edgeHorizonMin).

export function recordExit(symbol: string): void {
  lastExitTs.set(symbol, Date.now());
}

export function getActionMemoryBps(symbol: string, edgeHorizonMin: number): number {
  const ts = lastExitTs.get(symbol);
  if (!ts || edgeHorizonMin <= 0) return 0;
  const ageMin = (Date.now() - ts) / 60_000;
  const decay = Math.max(0, 1 - ageMin / edgeHorizonMin);
  if (decay === 0) { lastExitTs.delete(symbol); return 0; }
  return 2 * getExpectedSlippageBps(symbol, "buy", "regular") * decay;
}
