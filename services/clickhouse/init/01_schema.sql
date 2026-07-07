CREATE TABLE IF NOT EXISTS bars (
  symbol      LowCardinality(String),
  timeframe   LowCardinality(String),
  ts          DateTime64(3, 'UTC'),
  open        Float32,
  high        Float32,
  low         Float32,
  close       Float32,
  volume      UInt64,
  vwap        Nullable(Float32)
) ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (symbol, timeframe, ts);

CREATE TABLE IF NOT EXISTS scan_snapshots (
  id               UUID DEFAULT generateUUIDv4(),
  generated_at     DateTime64(3, 'UTC'),
  horizon          LowCardinality(String),
  universe         LowCardinality(String),
  symbols_scanned  UInt16,
  cash_weight      Float32
) ENGINE = MergeTree()
ORDER BY generated_at;

CREATE TABLE IF NOT EXISTS scan_rows (
  snapshot_id   UUID,
  generated_at  DateTime64(3, 'UTC'),
  symbol        LowCardinality(String),
  decision      LowCardinality(String),
  role          LowCardinality(String),
  net           Float32,
  confidence    Float32,
  momentum      Float32,
  quality       Float32,
  liquidity     Float32,
  risk          Float32,
  composite     Float32,
  star          UInt8,
  star_score    Nullable(Float32),
  price         Float32,
  p_up          Float32,
  mu            Float32,
  model_edge    Float32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(generated_at)
ORDER BY (generated_at, symbol);
