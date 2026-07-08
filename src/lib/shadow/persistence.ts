// Shadow monitor CH persistence. Fail-open contract identical to
// src/lib/data/clickhouse.ts — silent no-op when CLICKHOUSE_URL is unset.

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomUUID } from "crypto";
import { recordError } from "@/lib/data/metrics";

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
    });
    return client;
  } catch (err) {
    console.warn("[shadow] persistence init failed:", err);
    return null;
  }
}

// -- Types --------------------------------------------------------------------

export interface PendingRow {
  id: string;
  horizon: string;
  symbol: string;
  submittedAt: string;
  baselineDecision: string;
  challengerDecision: string;
  baselineNetBps: number;
  challengerNetBps: number;
  entryPrice: number;
  bucket: string;
  features: number[];
  source: "live" | "historical";
}

export interface ResolvedRow {
  id: string;
  horizon: string;
  symbol: string;
  submittedAt: string;
  resolvedAt: string;
  baselineDecision: string;
  challengerDecision: string;
  realizedBps: number;
  baselineValueBps: number;
  challengerValueBps: number;
  deltaBps: number;
  source: "live" | "historical";
  clean: 0 | 1;
}

export interface BucketRow {
  horizon: string;
  bucket: string;
  updatedAt: string;
  n: number;
  meanY: number;
  meanX: number[];
  xtx: number[];   // length 64, row-major 8×8
  xty: number[];   // length 8
}

export function newId(): string {
  return randomUUID();
}

// -- Pending ------------------------------------------------------------------

export async function insertPending(row: PendingRow): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.insert({
      table: "shadow_pending",
      values: [{
        id: row.id,
        horizon: row.horizon,
        symbol: row.symbol,
        submitted_at: row.submittedAt,
        baseline_decision: row.baselineDecision,
        challenger_decision: row.challengerDecision,
        baseline_net_bps: row.baselineNetBps,
        challenger_net_bps: row.challengerNetBps,
        entry_price: row.entryPrice,
        bucket: row.bucket,
        features: row.features,
        source: row.source,
      }],
      format: "JSONEachRow",
    });
  } catch (err) {
    recordError({ kind: "ch", message: `shadow insertPending: ${(err as Error)?.message}` });
  }
}

export async function queryPendingExpired(
  horizon: string,
  olderThanMs: number,
): Promise<PendingRow[]> {
  const c = getClient();
  if (!c) return [];
  try {
    const rs = await c.query({
      query: `
        SELECT
          toString(id) AS id,
          horizon, symbol,
          formatDateTime(submitted_at, '%Y-%m-%dT%H:%M:%SZ') AS submittedAt,
          baseline_decision AS baselineDecision,
          challenger_decision AS challengerDecision,
          baseline_net_bps AS baselineNetBps,
          challenger_net_bps AS challengerNetBps,
          entry_price AS entryPrice,
          bucket,
          features,
          source
        FROM shadow_pending
        WHERE horizon = {horizon:String}
          AND submitted_at <= parseDateTimeBestEffort({cutoff:String})
      `,
      query_params: {
        horizon,
        cutoff: new Date(Date.now() - olderThanMs).toISOString(),
      },
      format: "JSONEachRow",
    });
    return (await rs.json()) as PendingRow[];
  } catch {
    return [];
  }
}

export async function deletePending(id: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.command({
      query: `ALTER TABLE shadow_pending DELETE WHERE id = {id:UUID}`,
      query_params: { id },
    });
  } catch (err) {
    recordError({ kind: "ch", message: `shadow deletePending: ${(err as Error)?.message}` });
  }
}

// -- Resolved -----------------------------------------------------------------

export async function insertResolved(row: ResolvedRow): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.insert({
      table: "shadow_resolved",
      values: [{
        id: row.id,
        horizon: row.horizon,
        symbol: row.symbol,
        submitted_at: row.submittedAt,
        resolved_at: row.resolvedAt,
        baseline_decision: row.baselineDecision,
        challenger_decision: row.challengerDecision,
        realized_bps: row.realizedBps,
        baseline_value_bps: row.baselineValueBps,
        challenger_value_bps: row.challengerValueBps,
        delta_bps: row.deltaBps,
        source: row.source,
        clean: row.clean,
      }],
      format: "JSONEachRow",
    });
  } catch (err) {
    recordError({ kind: "ch", message: `shadow insertResolved: ${(err as Error)?.message}` });
  }
}

export async function countResolvedHistorical(horizon: string): Promise<number> {
  const c = getClient();
  if (!c) return 0;
  try {
    const rs = await c.query({
      query: `SELECT count() AS n FROM shadow_resolved WHERE horizon = {horizon:String} AND source = 'historical'`,
      query_params: { horizon },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

export async function queryResolvedForPosterior(
  horizon: string,
  source: "live" | "historical" | "all" = "all",
): Promise<Array<{ delta_bps: number }>> {
  const c = getClient();
  if (!c) return [];
  const sourceClause =
    source === "all" ? "" : `AND source = '${source === "live" ? "live" : "historical"}'`;
  try {
    const rs = await c.query({
      query: `
        SELECT delta_bps
        FROM shadow_resolved
        WHERE horizon = {horizon:String} AND clean = 1 ${sourceClause}
      `,
      query_params: { horizon },
      format: "JSONEachRow",
    });
    return (await rs.json()) as Array<{ delta_bps: number }>;
  } catch {
    return [];
  }
}

export async function queryRecentPending(horizon: string, limit: number): Promise<PendingRow[]> {
  const c = getClient();
  if (!c) return [];
  try {
    const rs = await c.query({
      query: `
        SELECT
          toString(id) AS id,
          horizon, symbol,
          formatDateTime(submitted_at, '%Y-%m-%dT%H:%M:%SZ') AS submittedAt,
          baseline_decision AS baselineDecision,
          challenger_decision AS challengerDecision,
          baseline_net_bps AS baselineNetBps,
          challenger_net_bps AS challengerNetBps,
          entry_price AS entryPrice,
          bucket,
          features,
          source
        FROM shadow_pending
        WHERE horizon = {horizon:String}
        ORDER BY submitted_at DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { horizon, limit },
      format: "JSONEachRow",
    });
    return (await rs.json()) as PendingRow[];
  } catch {
    return [];
  }
}

export async function queryRecentResolvedLive(horizon: string, limit: number): Promise<ResolvedRow[]> {
  const c = getClient();
  if (!c) return [];
  try {
    const rs = await c.query({
      query: `
        SELECT
          toString(id) AS id,
          horizon, symbol,
          formatDateTime(submitted_at, '%Y-%m-%dT%H:%M:%SZ') AS submittedAt,
          formatDateTime(resolved_at, '%Y-%m-%dT%H:%M:%SZ') AS resolvedAt,
          baseline_decision AS baselineDecision,
          challenger_decision AS challengerDecision,
          realized_bps AS realizedBps,
          baseline_value_bps AS baselineValueBps,
          challenger_value_bps AS challengerValueBps,
          delta_bps AS deltaBps,
          source,
          clean
        FROM shadow_resolved
        WHERE horizon = {horizon:String} AND source = 'live'
        ORDER BY resolved_at DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { horizon, limit },
      format: "JSONEachRow",
    });
    return (await rs.json()) as ResolvedRow[];
  } catch {
    return [];
  }
}

export async function queryHistoricalDailyDelta(
  horizon: string,
): Promise<Array<{ day: string; mean_delta_bps: number; n: number }>> {
  const c = getClient();
  if (!c) return [];
  try {
    const rs = await c.query({
      query: `
        SELECT
          formatDateTime(toDate(submitted_at), '%Y-%m-%d') AS day,
          avg(delta_bps) AS mean_delta_bps,
          count() AS n
        FROM shadow_resolved
        WHERE horizon = {horizon:String} AND source = 'historical' AND clean = 1
        GROUP BY day
        ORDER BY day ASC
      `,
      query_params: { horizon },
      format: "JSONEachRow",
    });
    return (await rs.json()) as Array<{ day: string; mean_delta_bps: number; n: number }>;
  } catch {
    return [];
  }
}

// -- Buckets ------------------------------------------------------------------

export async function upsertBucket(row: BucketRow): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.insert({
      table: "shadow_buckets",
      values: [{
        horizon: row.horizon,
        bucket: row.bucket,
        updated_at: row.updatedAt,
        n: row.n,
        mean_y: row.meanY,
        mean_x: row.meanX,
        xtx: row.xtx,
        xty: row.xty,
      }],
      format: "JSONEachRow",
    });
  } catch (err) {
    recordError({ kind: "ch", message: `shadow upsertBucket: ${(err as Error)?.message}` });
  }
}

export async function loadBuckets(horizon: string): Promise<Map<string, BucketRow>> {
  const c = getClient();
  const out = new Map<string, BucketRow>();
  if (!c) return out;
  try {
    // ReplacingMergeTree — use FINAL to get latest per bucket.
    const rs = await c.query({
      query: `
        SELECT
          horizon, bucket,
          formatDateTime(updated_at, '%Y-%m-%dT%H:%M:%SZ') AS updatedAt,
          n, mean_y AS meanY, mean_x AS meanX, xtx, xty
        FROM shadow_buckets FINAL
        WHERE horizon = {horizon:String}
      `,
      query_params: { horizon },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as BucketRow[];
    for (const r of rows) out.set(r.bucket, r);
    return out;
  } catch {
    return out;
  }
}
