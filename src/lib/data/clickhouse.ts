// ClickHouse L2 store — bars + scan snapshots + per-row scores.
//
// Fail-open contract: if CLICKHOUSE_URL is unset OR any operation fails, this
// module logs a warning and no-ops. The scan path continues normally against
// Alpaca + in-memory cache. See docs/superpowers/specs/2026-07-07-universe-clickhouse-design.md.

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomUUID } from "crypto";
import type { DailyBar, IntradayBar } from "./bars";
import type { ScanSnapshot } from "@/lib/engine/types";

export type BarTimeframe = "1Day" | "5Min" | "1Min";

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
      // Buffered inserts: bars/rows are batched per call, no need for async_insert.
      clickhouse_settings: {
        date_time_input_format: "best_effort",
      },
    });
    return client;
  } catch (err) {
    console.warn("[clickhouse] client init failed:", err);
    return null;
  }
}

export function isClickhouseEnabled(): boolean {
  return getClient() !== null;
}

// -- Bars ---------------------------------------------------------------------

interface BarRow {
  symbol: string;
  timeframe: BarTimeframe;
  ts: string;   // ISO8601
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
}

export async function insertBars(
  symbol: string,
  timeframe: BarTimeframe,
  bars: (DailyBar | IntradayBar)[],
): Promise<void> {
  const c = getClient();
  if (!c || bars.length === 0) return;
  const rows: BarRow[] = bars.map((b) => ({
    symbol,
    timeframe,
    ts: b.t,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
    vwap: b.vw ?? null,
  }));
  try {
    await c.insert({
      table: "bars",
      values: rows,
      format: "JSONEachRow",
    });
  } catch (err) {
    console.warn(`[clickhouse] insertBars(${symbol}, ${timeframe}) failed:`, err);
  }
}

export async function queryBars(
  symbol: string,
  timeframe: BarTimeframe,
  startISO: string,
  endISO: string,
): Promise<DailyBar[]> {
  const c = getClient();
  if (!c) return [];
  try {
    const rs = await c.query({
      query: `
        SELECT
          formatDateTime(ts, '%Y-%m-%dT%H:%i:%SZ') AS t,
          open AS o, high AS h, low AS l, close AS c, volume AS v, vwap AS vw
        FROM bars FINAL
        WHERE symbol = {symbol:String}
          AND timeframe = {timeframe:String}
          AND ts >= parseDateTimeBestEffort({start:String})
          AND ts <= parseDateTimeBestEffort({end:String})
        ORDER BY ts ASC
      `,
      query_params: { symbol, timeframe, start: startISO, end: endISO },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as Array<{
      t: string; o: number; h: number; l: number; c: number; v: number; vw: number | null;
    }>;
    return rows.map((r) => ({
      t: r.t,
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
      v: r.v,
      ...(r.vw != null ? { vw: r.vw } : {}),
    }));
  } catch (err) {
    console.warn(`[clickhouse] queryBars(${symbol}, ${timeframe}) failed:`, err);
    return [];
  }
}

/**
 * Batched bar read. Fetches bars for ALL requested symbols in a single CH query,
 * returning a Map keyed by symbol. Symbols with no rows in CH are simply absent
 * from the returned map — callers detect this and fall through to Alpaca.
 *
 * On any error or when CH is disabled, returns an empty Map (fail-open).
 */
export async function queryBarsMulti(
  symbols: string[],
  timeframe: BarTimeframe,
  startISO: string,
  endISO: string,
): Promise<Map<string, DailyBar[]>> {
  const c = getClient();
  if (!c || symbols.length === 0) return new Map();
  try {
    const rs = await c.query({
      query: `
        SELECT
          symbol,
          formatDateTime(ts, '%Y-%m-%dT%H:%i:%SZ') AS t,
          open AS o, high AS h, low AS l, close AS c, volume AS v, vwap AS vw
        FROM bars FINAL
        WHERE symbol IN ({symbols:Array(String)})
          AND timeframe = {timeframe:String}
          AND ts >= parseDateTimeBestEffort({start:String})
          AND ts <= parseDateTimeBestEffort({end:String})
        ORDER BY symbol ASC, ts ASC
      `,
      query_params: { symbols, timeframe, start: startISO, end: endISO },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as Array<{
      symbol: string; t: string; o: number; h: number; l: number; c: number; v: number; vw: number | null;
    }>;
    const out = new Map<string, DailyBar[]>();
    for (const r of rows) {
      const bar: DailyBar = {
        t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v,
        ...(r.vw != null ? { vw: r.vw } : {}),
      };
      const existing = out.get(r.symbol);
      if (existing) existing.push(bar);
      else out.set(r.symbol, [bar]);
    }
    return out;
  } catch (err) {
    console.warn(`[clickhouse] queryBarsMulti(${symbols.length} symbols, ${timeframe}) failed:`, err);
    return new Map();
  }
}

// -- Scan snapshots + rows ----------------------------------------------------

export async function insertSnapshot(snapshot: ScanSnapshot): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  const id = randomUUID();
  try {
    await c.insert({
      table: "scan_snapshots",
      values: [{
        id,
        generated_at: snapshot.generatedAt,
        horizon: snapshot.horizon,
        universe: snapshot.universe,
        symbols_scanned: snapshot.symbolsScanned,
        cash_weight: snapshot.cashWeight,
      }],
      format: "JSONEachRow",
    });
    return id;
  } catch (err) {
    console.warn("[clickhouse] insertSnapshot failed:", err);
    return null;
  }
}

export async function insertScanRows(
  snapshotId: string,
  snapshot: ScanSnapshot,
): Promise<void> {
  const c = getClient();
  if (!c || snapshot.rows.length === 0) return;
  const rows = snapshot.rows.map((r) => ({
    snapshot_id: snapshotId,
    generated_at: snapshot.generatedAt,
    symbol: r.symbol,
    decision: r.decision,
    role: r.role,
    net: r.net,
    confidence: r.confidence,
    momentum: r.momentum,
    quality: r.quality,
    liquidity: r.liquidity,
    risk: r.risk,
    composite: r.composite,
    star: r.star ? 1 : 0,
    star_score: r.starScore,
    price: r.price,
    p_up: r.pUp,
    mu: r.mu,
    model_edge: r.modelEdge,
  }));
  try {
    await c.insert({
      table: "scan_rows",
      values: rows,
      format: "JSONEachRow",
    });
  } catch (err) {
    console.warn(`[clickhouse] insertScanRows(${snapshotId}) failed:`, err);
  }
}
