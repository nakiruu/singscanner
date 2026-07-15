// Canonical SessionBucket enum + helpers.
//
// Before consolidation, the same literal type was defined in three places:
//   - src/lib/shadow/features.ts (used by shadow monitor + backlog)
//   - src/lib/data/microstructure.ts (used by adverse-selection estimator)
//   - src/lib/data/tca.ts (used by TCA panel bucketing)
//
// This module is the single source of truth. Downstream files now re-export
// or import from here. The classifier helpers exposed here match
// features.ts:sessionBucketNow behavior exactly — moving them here would
// break the shadow monitor's wall-clock semantics, so they're duplicated
// with a shared type instead.

export const SESSION_BUCKETS = ["regular", "premarket", "afterhours", "closed"] as const;
export type SessionBucket = typeof SESSION_BUCKETS[number];

// Type guard for parsing untyped strings (e.g. ClickHouse round-trips).
export function isSessionBucket(s: string): s is SessionBucket {
  return (SESSION_BUCKETS as readonly string[]).includes(s);
}

// Pure classification from an ET hour-of-day (0-23). Weekend handling is
// caller responsibility — this helper only maps hours, matching TCA's
// sessionFromHour but exposed as the canonical implementation.
export function sessionFromHourET(hourET: number): SessionBucket {
  if (hourET >= 9 && hourET < 16) return "regular";
  if (hourET >= 4 && hourET < 9) return "premarket";
  if (hourET >= 16 && hourET < 20) return "afterhours";
  return "closed";
}
