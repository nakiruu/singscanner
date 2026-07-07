# Universe expansion + ClickHouse integration

**Date:** 2026-07-07
**Status:** Approved

## Goals

1. Expand the scan universe from 100 (default) / 300 (docker-compose) to 600 symbols.
2. Add a self-hosted ClickHouse service as an L2 bar cache and full audit store (bars + scan snapshots + per-row scores).

---

## 1. Universe expansion

Two default values change; no logic changes required.

| File | Before | After |
|---|---|---|
| `src/lib/engine/scanner.ts:48` | `SCANNER_MAX_SYMBOLS ?? "100"` | `SCANNER_MAX_SYMBOLS ?? "600"` |
| `docker-compose.yml` | `SCANNER_MAX_SYMBOLS:-300` | `SCANNER_MAX_SYMBOLS:-600` |

`universe.ts` already handles any `maxSymbols` value via `rankByDollarVolume`. The `<= 300` short-circuit guard for the hardcoded default universe never fires at 600, which is correct — the full ranked path is always used.

---

## 2. ClickHouse schema

Three tables, defined in `services/clickhouse/init/01_schema.sql` (auto-executed on container first boot).

### bars

Stores OHLCV for both daily and intraday timeframes.

```sql
CREATE TABLE IF NOT EXISTS bars (
  symbol      LowCardinality(String),
  timeframe   LowCardinality(String),  -- '1Day' | '5Min' | '1Min'
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
```

`ReplacingMergeTree` deduplicates rows with the same `(symbol, timeframe, ts)` at merge time, so re-inserting on a cache miss is safe.

### scan_snapshots

One row per completed scan run.

```sql
CREATE TABLE IF NOT EXISTS scan_snapshots (
  id               UUID DEFAULT generateUUIDv4(),
  generated_at     DateTime64(3, 'UTC'),
  horizon          LowCardinality(String),
  universe         LowCardinality(String),
  symbols_scanned  UInt16,
  cash_weight      Float32
) ENGINE = MergeTree()
ORDER BY generated_at;
```

### scan_rows

All `ScanRow` scoring fields, one row per symbol per scan. Partitioned by month for cheap time-range queries.

```sql
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
```

---

## 3. Data flow

### Bar reads (L1 → L2 → Alpaca)

```
fetchDailyBars(symbols, lookbackDays)
  │
  ├─ L1: in-memory Map (6h TTL)      hit → return immediately
  │
  ├─ L2: ClickHouse                  hit → compute date gaps
  │        │                                    │
  │        │                          gap exists → Alpaca fetch (gap range only)
  │        │                                    │
  │        │                          write new bars to CH (async)
  │        │                                    │
  │        └────────────────────────────────────▶ merged result → L1 cache → return
  │
  └─ CH miss / CH down → Alpaca fetch (full range) → write to CH (async) → L1 cache → return
```

Gap detection for daily bars: CH returns bars for `(symbol, '1Day', ts ≥ rangeStart)`. The earliest missing calendar date becomes the Alpaca fetch start. For intraday bars (60s L1 TTL), the gap is almost always the full range on the first call, then CH serves within-minute repeats.

### Scan result writes (fire-and-forget)

After `buildLiveSnapshot()` returns a `ScanSnapshot`, the stream route fires an async write (no await, no scan-path blocking):

```
buildLiveSnapshot() → ScanSnapshot
  │
  ├─ stream to client (unchanged)
  │
  └─ fire-and-forget:
       insertSnapshot(snapshot)   → scan_snapshots row
       insertScanRows(snapshot)   → N scan_rows rows
```

---

## 4. New files

| Path | Purpose |
|---|---|
| `src/lib/data/clickhouse.ts` | Singleton `@clickhouse/client` client. Exports: `insertBars()`, `queryBars()`, `insertSnapshot()`, `insertScanRows()`. All methods silently no-op if `CLICKHOUSE_URL` is unset. |
| `services/clickhouse/init/01_schema.sql` | `CREATE TABLE IF NOT EXISTS` for all three tables. Auto-run on container init. |

## 5. Modified files

| Path | Change |
|---|---|
| `src/lib/engine/scanner.ts` | `SCANNER_MAX_SYMBOLS` default 100 → 600 |
| `src/lib/data/bars.ts` | CH read (after L1 miss) + CH write (after Alpaca fetch) in `fetchDailyBars` and `fetchIntradayBars` |
| `src/app/api/scan/stream/route.ts` | Fire-and-forget `insertSnapshot` + `insertScanRows` after snapshot ready |
| `docker-compose.yml` | Add `clickhouse` service; add `CLICKHOUSE_*` env vars to `app`; update `SCANNER_MAX_SYMBOLS` default |

---

## 6. docker-compose additions

```yaml
clickhouse:
  image: clickhouse/clickhouse-server:24-alpine
  container_name: singscanner-ch
  restart: unless-stopped
  volumes:
    - chdata:/var/lib/clickhouse
    - ./services/clickhouse/init:/docker-entrypoint-initdb.d:ro
  environment:
    CLICKHOUSE_USER: singscanner
    CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD:-changeme}
    CLICKHOUSE_DB: singscanner
  healthcheck:
    test: ["CMD", "clickhouse-client", "--query", "SELECT 1"]
    interval: 10s
    timeout: 5s
    retries: 5
```

New env vars on the `app` service:

```yaml
CLICKHOUSE_URL: http://clickhouse:8123
CLICKHOUSE_USER: singscanner
CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD:-changeme}
CLICKHOUSE_DB: singscanner
```

New named volume: `chdata`.

---

## 7. Fallback guarantee

Every CH call is wrapped in `try/catch`. If `CLICKHOUSE_URL` is unset or CH is unreachable, every method in `clickhouse.ts` no-ops and the scan path is identical to the pre-ClickHouse behaviour. CH is never a hard scan dependency.

---

## 8. Dependencies

- `@clickhouse/client` (Node.js official ClickHouse client) added to `package.json`.
- No ORM, no migrations framework — schema is plain SQL in the init file.
