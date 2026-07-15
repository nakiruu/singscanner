// Shadow bucket schema migration.
//
// The dynamic challenger's persisted state (shadow_buckets.xtx / xty / meanX
// / meanY) is computed against a specific FEATURE SCALE and RIDGE
// FORMULATION. When we flip a code-level switch that changes either — most
// obviously P1a #3's SHADOW_FEATURE_STANDARDIZATION=1, which z-scores
// features before they enter the accumulator — pre-existing buckets in CH
// are on the OLD scale and would be silently misinterpreted by the new
// code path.
//
// This module tracks a SHADOW_BUCKET_SCHEMA_VERSION per horizon and lets
// the challenger detect + reset buckets on version mismatch. The reset is
// intentionally destructive: the challenger re-warms from shadow_resolved
// on subsequent updates (~few days back to steady state, per DECAY_FACTOR).
// That's the correct behavior — using stale-scale buckets would produce
// wrong ridge predictions.
//
// Version encoding: a small metadata table `shadow_schema_meta` stores
// (horizon, version, applied_at). On startup, ShadowMonitor checks the
// stored version against the code's SHADOW_BUCKET_SCHEMA_VERSION env
// and either accepts, rebuilds, or refuses to boot per the migration mode.

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { recordError } from "@/lib/data/metrics";

export type Horizon = "3d" | "5d" | "10d";

// The version to publish. Bump this when any of the following change:
//   - Feature vector layout (N_FEATURES or the order in FEATURE_NAMES)
//   - Ridge accumulator formula (xtx, xty, meanX, meanY)
//   - Standardization / winsorization applied before xtx write
//   - Decay factor (only if DECAY_FACTOR moves to a different steady-state n)
const CODE_SCHEMA_VERSION = Number(process.env.SHADOW_BUCKET_SCHEMA_VERSION ?? "1");

// Migration mode:
//   "warn"    — log a warning on mismatch, keep running with stale buckets
//   "rebuild" — delete stale rows on mismatch, re-warm from resolved rows
//   "refuse"  — throw on mismatch, force operator to reconcile
const MIGRATION_MODE = (process.env.SHADOW_BUCKET_MIGRATION_MODE ?? "warn") as MigrationMode;
type MigrationMode = "warn" | "rebuild" | "refuse";

export interface SchemaCheckResult {
  horizon: Horizon;
  codeVersion: number;
  storedVersion: number | null;   // null when the meta row doesn't exist yet
  match: boolean;
  action: "accept" | "warn" | "rebuild" | "refuse" | "initialize";
  message: string;
}

// Local CH client.
let client: ClickHouseClient | null = null;
let initialized = false;

function getClient(): ClickHouseClient | null {
  if (initialized) return client;
  initialized = true;
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  try {
    client = createClient({
      url,
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DB ?? "default",
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
    return client;
  } catch (err) {
    console.warn("[shadow-schema-migration] client init failed:", err);
    return null;
  }
}

// Bootstrap: ensure the meta table exists. Called lazily on first
// checkSchemaVersion so an operator running with CH offline still gets a
// clean fail-open in checkSchemaVersion below.
async function ensureMetaTable(c: ClickHouseClient): Promise<void> {
  await c.exec({
    query: `
      CREATE TABLE IF NOT EXISTS shadow_schema_meta (
        horizon    LowCardinality(String),
        version    UInt32,
        applied_at DateTime64(3, 'UTC') DEFAULT now64(3)
      ) ENGINE = ReplacingMergeTree(applied_at)
      ORDER BY horizon
    `,
  });
}

// Check whether the persisted schema version matches the code's. Called
// from ShadowMonitor.init BEFORE loading buckets so the caller can decide
// whether to trust the CH state.
//
// Returns SchemaCheckResult describing what happened. When action='rebuild',
// the caller should also invoke resetHorizonBuckets(horizon) to purge stale
// rows; this function does not delete anything by itself.
export async function checkSchemaVersion(horizon: Horizon): Promise<SchemaCheckResult> {
  const c = getClient();
  if (!c) {
    return {
      horizon,
      codeVersion: CODE_SCHEMA_VERSION,
      storedVersion: null,
      match: true,   // fail-open: no CH means no mismatch possible
      action: "accept",
      message: "CH disabled — schema check skipped",
    };
  }
  try {
    await ensureMetaTable(c);
    const rs = await c.query({
      query: `
        SELECT version
        FROM shadow_schema_meta FINAL
        WHERE horizon = {horizon:String}
      `,
      query_params: { horizon },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as Array<{ version: number | string }>;
    const storedVersion = rows.length > 0 ? Number(rows[0].version) : null;

    if (storedVersion === null) {
      // First boot for this horizon — record the code version.
      await recordSchemaVersion(horizon, CODE_SCHEMA_VERSION);
      return {
        horizon,
        codeVersion: CODE_SCHEMA_VERSION,
        storedVersion: null,
        match: true,
        action: "initialize",
        message: `Initialized schema meta at v${CODE_SCHEMA_VERSION}`,
      };
    }

    if (storedVersion === CODE_SCHEMA_VERSION) {
      return {
        horizon,
        codeVersion: CODE_SCHEMA_VERSION,
        storedVersion,
        match: true,
        action: "accept",
        message: `Schema v${CODE_SCHEMA_VERSION} matches — buckets trusted`,
      };
    }

    // Mismatch — dispatch by migration mode.
    const base = { horizon, codeVersion: CODE_SCHEMA_VERSION, storedVersion, match: false };
    if (MIGRATION_MODE === "refuse") {
      return {
        ...base,
        action: "refuse",
        message: `Schema mismatch (code=v${CODE_SCHEMA_VERSION}, stored=v${storedVersion}); ` +
          `SHADOW_BUCKET_MIGRATION_MODE=refuse — will not boot`,
      };
    }
    if (MIGRATION_MODE === "rebuild") {
      return {
        ...base,
        action: "rebuild",
        message: `Schema mismatch (code=v${CODE_SCHEMA_VERSION}, stored=v${storedVersion}); ` +
          `caller should invoke resetHorizonBuckets(${horizon}) and re-record version`,
      };
    }
    return {
      ...base,
      action: "warn",
      message: `Schema mismatch (code=v${CODE_SCHEMA_VERSION}, stored=v${storedVersion}); ` +
        `SHADOW_BUCKET_MIGRATION_MODE=warn — continuing with stale buckets (UNSAFE)`,
    };
  } catch (err) {
    if (err instanceof Error) {
      recordError({ kind: "ch", message: `checkSchemaVersion(${horizon}): ${err.message}`, stack: err.stack });
    }
    return {
      horizon,
      codeVersion: CODE_SCHEMA_VERSION,
      storedVersion: null,
      match: true,
      action: "accept",
      message: `Schema check failed — falling open`,
    };
  }
}

// Destructive: delete all shadow_buckets rows for a horizon so the
// challenger can re-warm from shadow_resolved.
export async function resetHorizonBuckets(horizon: Horizon): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.exec({
      query: `ALTER TABLE shadow_buckets DELETE WHERE horizon = {horizon:String}`,
      query_params: { horizon },
    });
    await recordSchemaVersion(horizon, CODE_SCHEMA_VERSION);
  } catch (err) {
    if (err instanceof Error) {
      recordError({ kind: "ch", message: `resetHorizonBuckets(${horizon}): ${err.message}`, stack: err.stack });
    }
  }
}

async function recordSchemaVersion(horizon: Horizon, version: number): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.insert({
      table: "shadow_schema_meta",
      values: [{ horizon, version, applied_at: new Date().toISOString() }],
      format: "JSONEachRow",
    });
  } catch (err) {
    if (err instanceof Error) {
      recordError({ kind: "ch", message: `recordSchemaVersion(${horizon}, v${version}): ${err.message}`, stack: err.stack });
    }
  }
}
