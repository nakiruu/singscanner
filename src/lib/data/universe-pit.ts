// Point-in-time (PIT) universe module.
//
// `fetchActiveUniverse` returns the CURRENT S&P 500 ∪ NDX membership. Any
// backlog run over a historical window that consults today's universe induces
// survivorship bias — companies that were in the index in 2023 but got
// removed by 2026 are silently missing from replays, and companies added
// after 2023 are silently included. López de Prado (2018 ch. 4) reports
// the aggregate bias at ~100-300 bps/yr past 3 years.
//
// This module provides the API surface for a PIT universe fetcher but ships
// with an unimplemented data-source layer — the actual historical
// constituent data requires either:
//
//   1. A paid vendor feed (FMP historical/sp500_constituent + historical/
//      nasdaq_constituent — check current tier), or
//   2. A JSON snapshot of month-end constituents shipped in
//      src/lib/data/universe-snapshots/, or
//   3. WRDS / S&P DJI direct feed.
//
// Callers gate on POINT_IN_TIME_UNIVERSE_ENABLED. When disabled, the module
// throws with a clear error so silent survivorship bias cannot occur —
// callers must either enable the flag (and provide a data source) or fall
// back to the current-universe path with a short lookback (see the
// HISTORICAL_LOOKBACK_DAYS runtime assert in backlog.ts).
//
// The interface is stable so B4-V1 (lookback assert) and downstream backlog
// wiring can land ahead of the data-source implementation.

export interface UniverseEntry {
  symbol: string;
  source: "sp500" | "ndx" | "both";
}

export const POINT_IN_TIME_UNIVERSE_ENABLED =
  process.env.POINT_IN_TIME_UNIVERSE_ENABLED === "true";

// The maximum lookback that is safe to use WITHOUT a PIT universe. Beyond
// this, survivorship bias becomes material (see module header). Consumers
// (backlog.ts) enforce this at boot; kept here as the canonical constant.
export const MAX_LOOKBACK_WITHOUT_PIT_DAYS = 750;
export const LOOKBACK_WARNING_DAYS = 500;

export class PointInTimeUniverseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PointInTimeUniverseError";
  }
}

// Return the S&P 500 ∪ NDX universe as it existed on `isoDate`.
//
// isoDate: ISO-8601 date (YYYY-MM-DD).
// maxSymbols: optional soft cap; when omitted returns full membership.
//
// Throws PointInTimeUniverseError when:
//   - POINT_IN_TIME_UNIVERSE_ENABLED is false (silent fallback would be a bug)
//   - The historical data source is unavailable for the requested date
//   - isoDate is malformed or in the future
export async function universeAsOf(
  isoDate: string,
  maxSymbols?: number,
): Promise<UniverseEntry[]> {
  if (!isValidIsoDate(isoDate)) {
    throw new PointInTimeUniverseError(`invalid isoDate: ${isoDate}`);
  }
  const asOf = new Date(isoDate + "T00:00:00Z").getTime();
  if (!Number.isFinite(asOf) || asOf > Date.now()) {
    throw new PointInTimeUniverseError(`isoDate is in the future or unparseable: ${isoDate}`);
  }
  if (!POINT_IN_TIME_UNIVERSE_ENABLED) {
    throw new PointInTimeUniverseError(
      "PIT universe not enabled — set POINT_IN_TIME_UNIVERSE_ENABLED=true and " +
      "wire a historical constituent data source before running long-lookback backlogs.",
    );
  }
  // TODO(data-source): wire one of the three options in the module header.
  // For now, throw so callers cannot silently degrade to survivorship-biased
  // behavior. The module surface (interface + flag + error class) is stable —
  // only the fetcher body below needs implementing.
  throw new PointInTimeUniverseError(
    "PIT universe data source not yet wired. See src/lib/data/universe-pit.ts " +
    "module header for the three implementation options.",
  );

  // Placeholder for the eventual return path:
  // return trimUniverse(entriesForDate, maxSymbols);
}

// Runtime guard used by callers that operate on historical dates. Throws when
// the lookback exceeds MAX_LOOKBACK_WITHOUT_PIT_DAYS without a live PIT
// universe. Non-throwing warning between LOOKBACK_WARNING_DAYS and the hard
// limit.
export function assertPointInTimeAvailable(lookbackDays: number): void {
  if (lookbackDays > MAX_LOOKBACK_WITHOUT_PIT_DAYS && !POINT_IN_TIME_UNIVERSE_ENABLED) {
    throw new PointInTimeUniverseError(
      `HISTORICAL_LOOKBACK_DAYS=${lookbackDays} exceeds ${MAX_LOOKBACK_WITHOUT_PIT_DAYS} ` +
      `(~3 years) without POINT_IN_TIME_UNIVERSE_ENABLED. Universe drift induces ` +
      `100-300 bps/yr of survivorship bias past 3 years (López de Prado 2018 ch. 4). ` +
      `Enable the PIT universe module or reduce the lookback.`,
    );
  }
  if (lookbackDays > LOOKBACK_WARNING_DAYS && !POINT_IN_TIME_UNIVERSE_ENABLED) {
    console.warn(
      `[universe-pit] lookback=${lookbackDays} exceeds ${LOOKBACK_WARNING_DAYS}d — ` +
      `consider enabling PIT universe before pushing past ${MAX_LOOKBACK_WITHOUT_PIT_DAYS}d.`,
    );
  }
}

// -- Helpers -----------------------------------------------------------------

function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
