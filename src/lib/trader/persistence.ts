// Fail-open ClickHouse persistence for the auto-trader. Every function
// catches internally and records the error — a CH outage must never stop
// the trading loop. Pattern mirrors src/lib/shadow/persistence.ts.

import { createClient, type ClickHouseClient } from "@clickhouse/client";
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
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
  } catch (err) {
    recordError({ kind: "ch", message: `trader CH client init failed: ${err}` });
    client = null;
  }
  return client;
}

export interface TraderOrderRow {
  horizon: string;
  submitted_at: string;          // ISO-8601
  symbol: string;
  side: "buy" | "sell";
  order_type: "bracket" | "limit" | "market" | "close" | "repair";
  qty: number;
  limit_price: number | null;
  stop_price: number | null;
  target_price: number | null;
  reason: string;
  alpaca_order_id: string;
  status: "submitted" | "filled" | "partial" | "canceled" | "error";
  expected_price: number | null;
  fill_price: number | null;
  slippage_bps: number | null;
}

export interface PositionEventRow {
  horizon: string;
  ts: string;                    // ISO-8601
  event_kind: "entry" | "exit" | "rotation" | "partial-fill";
  symbol: string;
  qty: number;
  fill_price: number;
  reason: string;
  pnl_bps: number | null;
  position_pct: number;
}

export async function insertTraderOrder(row: TraderOrderRow): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.insert({ table: "trader_orders", values: [row], format: "JSONEachRow" });
  } catch (err) {
    recordError({ kind: "ch", message: `insertTraderOrder(${row.symbol}) failed: ${err}` });
  }
}

export async function insertPositionEvent(row: PositionEventRow): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.insert({ table: "trader_position_events", values: [row], format: "JSONEachRow" });
  } catch (err) {
    recordError({ kind: "ch", message: `insertPositionEvent(${row.symbol}) failed: ${err}` });
  }
}
