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
