// Fixed-order feature vector for the dynamic action-value challenger.
// Layout MUST NOT change — bucket state (X'X, X'y) depends on stable indexing.

import type { ScanRow } from "@/lib/engine/types";

export const FEATURE_NAMES = [
  "role_primary",
  "role_secondary",
  "role_retained",
  "current_weight",
  "delta_weight",
  "cash_fraction",
  "has_open_order",
  "ticker_edge",
] as const;

export const N_FEATURES = FEATURE_NAMES.length; // 8

// Canonical SessionBucket enum — see src/lib/engine/session-bucket.ts.
// sessionBucketNow below has wall-clock + weekday semantics specific to
// the shadow monitor's live-observation path; the shared session-bucket
// module exposes the type + pure hour-of-day classifier.
export { type SessionBucket } from "@/lib/engine/session-bucket";
import type { SessionBucket } from "@/lib/engine/session-bucket";

// Coarse US/Eastern session classification for the current wall clock.
// Matches dynamic_challenger.py:_session_bucket_now.
export function sessionBucketNow(): SessionBucket {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minStr = parts.find((p) => p.type === "minute")?.value ?? "0";
  const weekend = weekdayStr === "Sat" || weekdayStr === "Sun";
  if (weekend) return "closed";
  const h = Number(hourStr) + Number(minStr) / 60;
  if (h >= 9.5 && h < 16) return "regular";
  if (h >= 4 && h < 9.5) return "premarket";
  if (h >= 16 && h < 20) return "afterhours";
  return "closed";
}

export function bucketKey(role: string, session: SessionBucket): string {
  return `${role}|${session}`;
}

export interface FeatureContext {
  cashFraction: number;
  tickerEdge: number;
  heldNotional?: number;
}

// Build the 8-feature vector. Matches dynamic_challenger.py:_extract_features
// with the v1 held-side substitution (heldNotional=0 unless caller provides).
export function extractFeatures(row: ScanRow, ctx: FeatureContext): number[] {
  const price = row.price || 0;
  const heldNotional = ctx.heldNotional ?? 0;
  // "notional" in the Python source is the trader's intended trade notional;
  // in v1 we use price × a nominal 20-share standin so current/delta_weight
  // have meaningful magnitude. Once the trader ships, callers can override
  // by passing heldNotional and adjusting semantics.
  const notional = price * 20;
  const denom = Math.max(notional * 20, 1);
  const currentWeight = heldNotional / denom;
  const deltaWeight = (notional - heldNotional) / denom;
  return [
    row.role === "primary" ? 1 : 0,
    row.role === "secondary" ? 1 : 0,
    row.role === "retained" ? 1 : 0,
    currentWeight,
    deltaWeight,
    ctx.cashFraction,
    0, // has_open_order — v1: always 0 (trader ships later)
    ctx.tickerEdge,
  ];
}
