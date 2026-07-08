CREATE TABLE IF NOT EXISTS shadow_pending (
  id                   UUID DEFAULT generateUUIDv4(),
  horizon              LowCardinality(String),
  symbol               LowCardinality(String),
  submitted_at         DateTime64(3, 'UTC'),
  baseline_decision    LowCardinality(String),
  challenger_decision  LowCardinality(String),
  baseline_net_bps     Float32,
  challenger_net_bps   Float32,
  entry_price          Float32,
  bucket               LowCardinality(String),
  features             Array(Float32),
  source               LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(submitted_at)
ORDER BY (submitted_at, horizon, symbol);

CREATE TABLE IF NOT EXISTS shadow_resolved (
  id                   UUID DEFAULT generateUUIDv4(),
  horizon              LowCardinality(String),
  symbol               LowCardinality(String),
  submitted_at         DateTime64(3, 'UTC'),
  resolved_at          DateTime64(3, 'UTC'),
  baseline_decision    LowCardinality(String),
  challenger_decision  LowCardinality(String),
  realized_bps         Float32,
  baseline_value_bps   Float32,
  challenger_value_bps Float32,
  delta_bps            Float32,
  source               LowCardinality(String),
  clean                UInt8
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(resolved_at)
ORDER BY (resolved_at, horizon, symbol);

CREATE TABLE IF NOT EXISTS shadow_buckets (
  horizon      LowCardinality(String),
  bucket       LowCardinality(String),
  updated_at   DateTime64(3, 'UTC'),
  n            UInt32,
  mean_y       Float32,
  mean_x       Array(Float32),
  xtx          Array(Float32),
  xty          Array(Float32)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (horizon, bucket);
