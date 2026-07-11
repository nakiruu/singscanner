-- Auto-trader order + position-event history (sub-project A).
-- NOTE: docker-entrypoint-initdb.d only runs on FRESH volumes, and runs against
-- the `default` database. On an existing deployment apply manually:
--   cat services/clickhouse/init/02_trader_schema.sql | \
--     docker exec -i singscanner-ch clickhouse-client -d singscanner --multiquery

CREATE TABLE IF NOT EXISTS trader_orders (
  id              UUID DEFAULT generateUUIDv4(),
  horizon         LowCardinality(String),
  submitted_at    DateTime64(3, 'UTC'),
  symbol          LowCardinality(String),
  side            LowCardinality(String),   -- 'buy' | 'sell'
  order_type      LowCardinality(String),   -- 'bracket' | 'limit' | 'market' | 'close' | 'repair'
  qty             Float32,
  limit_price     Nullable(Float32),
  stop_price      Nullable(Float32),
  target_price    Nullable(Float32),
  reason          String,                   -- e.g. 'star-entry', 'sell-stop', 'repair-orphan'
  alpaca_order_id String,
  status          LowCardinality(String),   -- 'submitted' | 'filled' | 'partial' | 'canceled' | 'error'
  expected_price  Nullable(Float32),
  fill_price      Nullable(Float32),
  slippage_bps    Nullable(Float32)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(submitted_at)
ORDER BY (submitted_at, horizon, symbol);

CREATE TABLE IF NOT EXISTS trader_position_events (
  id             UUID DEFAULT generateUUIDv4(),
  horizon        LowCardinality(String),
  ts             DateTime64(3, 'UTC'),
  event_kind     LowCardinality(String),    -- 'entry' | 'exit' | 'rotation' | 'partial-fill'
  symbol         LowCardinality(String),
  qty            Float32,
  fill_price     Float32,
  reason         String,
  pnl_bps        Nullable(Float32),
  position_pct   Float32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (ts, horizon, symbol);
