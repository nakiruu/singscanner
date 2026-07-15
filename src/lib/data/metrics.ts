// In-memory instrumentation for the admin dashboard. Small ring buffers,
// no side effects outside this module. Callers wire recording; the admin
// summary API reads. See docs/superpowers/specs/2026-07-07-admin-dashboard-design.md.

import { randomUUID } from "crypto";

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

// -- Net divergence rolling counter (C6-2) -----------------------------------
//
// The shadow monitor flags rows where baseline and challenger produce the
// same decision but their net-bps values diverge by more than
// NET_DIVERGENCE_BPS (see monitor.ts). Tracking that rate per horizon
// exposes P(y|X) drift — a rising divergence rate means the challenger's
// per-bucket ridge has drifted meaningfully from the baseline's static
// friction, worth investigating before the drift becomes a promotion
// decision (Gama et al. 2014, "A Survey on Concept Drift Adaptation", ACM CS).

const DIVERGENCE_BUF_SIZE = 500;
interface DivergenceSample { horizon: string; ts: number }
const divergenceBuf: DivergenceSample[] = [];

// Called from monitor.ts:observe / backlog.ts when a row's baseline and
// challenger nets diverge past NET_DIVERGENCE_BPS.
export function recordNetDivergence(horizon: string): void {
  divergenceBuf.push({ horizon, ts: Date.now() });
  if (divergenceBuf.length > DIVERGENCE_BUF_SIZE) divergenceBuf.shift();
}

// Divergences per hour for a given horizon over the last windowMs.
// Returns 0 when the buffer has no data for that horizon in the window —
// callers distinguish "no drift" from "no data" via the returned count.
export function getNetDivergenceRate(
  horizon: string,
  windowMs = 3_600_000,
): { count: number; ratePerHour: number } {
  const cutoff = Date.now() - windowMs;
  let count = 0;
  for (const s of divergenceBuf) {
    if (s.horizon === horizon && s.ts >= cutoff) count++;
  }
  const hours = windowMs / 3_600_000;
  return { count, ratePerHour: hours > 0 ? count / hours : 0 };
}
