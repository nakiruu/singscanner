# Universe expansion + ClickHouse integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the scan universe to 600 symbols and add a self-hosted ClickHouse service as an L2 bar cache and full audit store (bars + scan snapshots + per-row scores).

**Architecture:** ClickHouse sits between the in-memory L1 cache and Alpaca. Bar reads check L1 → CH → Alpaca (gap-fill). Scan snapshots and per-row scores are written fire-and-forget after each new scan. Every CH call is wrapped in try/catch — if `CLICKHOUSE_URL` is unset or CH is unreachable, the scan path is identical to the pre-ClickHouse behaviour.

**Tech Stack:** Next.js 16, TypeScript, ClickHouse 24 (docker), `@clickhouse/client` (Node), docker-compose.

## Global Constraints

- **No test framework configured.** Validation uses `npm run build` (typecheck + compile), `npm run lint`, and manual boot verification via docker-compose. Do NOT add vitest/jest as part of this plan.
- **CH is never a hard dependency.** All CH methods must no-op silently if `CLICKHOUSE_URL` is unset, and swallow errors on connection failure.
- **File paths use forward slashes** in code even though the host is Windows — Next.js/Node normalises them.
- **Follow existing patterns:** module-scope caches, `LowCardinality` for enum-like strings, `console.warn` for degraded-mode logs. No new logging library.
- **Reference spec:** `docs/superpowers/specs/2026-07-07-universe-clickhouse-design.md`.

---

## File structure

**Create:**
- `src/lib/data/clickhouse.ts` — singleton `@clickhouse/client` wrapper. Exports `insertBars`, `queryBars`, `insertSnapshot`, `insertScanRows`. Silent no-op when `CLICKHOUSE_URL` is unset.
- `services/clickhouse/init/01_schema.sql` — three `CREATE TABLE IF NOT EXISTS` statements.

**Modify:**
- `src/lib/engine/scanner.ts:48` — `MAX_SYMBOLS` default 100 → 600. Add fire-and-forget CH snapshot write inside `getLatestSnapshot`.
- `src/lib/data/bars.ts` — CH read+write layer inside `fetchDailyBars` and `fetchIntradayBars`.
- `docker-compose.yml` — add `clickhouse` service, `chdata` volume, `CLICKHOUSE_*` env on `app`, bump `SCANNER_MAX_SYMBOLS:-300` → `SCANNER_MAX_SYMBOLS:-600`.
- `package.json` — add `@clickhouse/client` dep.

---

## Task 1: Universe expansion (defaults 100/300 → 600)

**Files:**
- Modify: `src/lib/engine/scanner.ts:48`
- Modify: `docker-compose.yml` (`SCANNER_MAX_SYMBOLS` default)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. Behaviour change only — larger default universe.

- [ ] **Step 1: Bump scanner.ts default**

In `src/lib/engine/scanner.ts` line 48, change:

```ts
const MAX_SYMBOLS = Math.max(10, Number(process.env.SCANNER_MAX_SYMBOLS ?? "100"));
```

to:

```ts
const MAX_SYMBOLS = Math.max(10, Number(process.env.SCANNER_MAX_SYMBOLS ?? "600"));
```

- [ ] **Step 2: Bump docker-compose default**

In `docker-compose.yml`, find the line:

```yaml
      SCANNER_MAX_SYMBOLS: ${SCANNER_MAX_SYMBOLS:-300}
```

Change to:

```yaml
      SCANNER_MAX_SYMBOLS: ${SCANNER_MAX_SYMBOLS:-600}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build completes without TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/engine/scanner.ts docker-compose.yml
git commit -m "feat(scanner): expand default universe to 600 symbols"
```

---

## Task 2: ClickHouse docker service + schema init

**Files:**
- Create: `services/clickhouse/init/01_schema.sql`
- Modify: `docker-compose.yml` (new `clickhouse` service, `chdata` volume, `CLICKHOUSE_*` env on `app`)

**Interfaces:**
- Consumes: nothing.
- Produces: A running CH server reachable at `http://clickhouse:8123` from the `app` container. Schema is auto-applied on first boot via `/docker-entrypoint-initdb.d`.

- [ ] **Step 1: Write the schema init file**

Create `services/clickhouse/init/01_schema.sql` with exactly this content:

```sql
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
```

- [ ] **Step 2: Add clickhouse service to docker-compose.yml**

In `docker-compose.yml`, insert a new service block after the existing `postgres` block (before `app`):

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
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8123/ping"]
      interval: 10s
      timeout: 5s
      retries: 5
```

- [ ] **Step 3: Wire CH env vars + depends_on into the app service**

In the `app` service block, under `depends_on`, add:

```yaml
      clickhouse:
        condition: service_healthy
```

Under `environment`, add:

```yaml
      CLICKHOUSE_URL: ${CLICKHOUSE_URL:-http://clickhouse:8123}
      CLICKHOUSE_USER: ${CLICKHOUSE_USER:-singscanner}
      CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD:-changeme}
      CLICKHOUSE_DB: ${CLICKHOUSE_DB:-singscanner}
```

- [ ] **Step 4: Add chdata volume**

At the bottom of `docker-compose.yml`, under `volumes:`, add `chdata:` alongside `pgdata:` and `fundamentals_cache:`:

```yaml
volumes:
  pgdata:
  fundamentals_cache:
  chdata:
```

- [ ] **Step 5: Verify docker-compose config is valid**

Run: `docker compose config`
Expected: prints the fully-rendered config with the `clickhouse` service listed and no parse errors.

- [ ] **Step 6: Boot CH standalone and verify schema**

Run: `docker compose up -d clickhouse`
Then wait ~15s and run:

```bash
docker exec singscanner-ch clickhouse-client --query "SHOW TABLES FROM singscanner"
```

Expected output (three lines):
```
bars
scan_rows
scan_snapshots
```

If any table is missing, check `docker logs singscanner-ch` for SQL errors and fix `01_schema.sql`.

- [ ] **Step 7: Commit**

```bash
git add services/clickhouse/init/01_schema.sql docker-compose.yml
git commit -m "feat(infra): add self-hosted ClickHouse with bars/snapshots/rows schema"
```

---

## Task 3: ClickHouse TypeScript client (`src/lib/data/clickhouse.ts`)

**Files:**
- Create: `src/lib/data/clickhouse.ts`
- Modify: `package.json` (add `@clickhouse/client` dep)

**Interfaces:**
- Consumes: `ScanSnapshot`, `ScanRow` from `@/lib/engine/types`; `DailyBar`, `IntradayBar` from `@/lib/data/bars`.
- Produces:
  - `insertBars(symbol: string, timeframe: "1Day" | "5Min" | "1Min", bars: DailyBar[] | IntradayBar[]): Promise<void>`
  - `queryBars(symbol: string, timeframe: "1Day" | "5Min" | "1Min", startISO: string, endISO: string): Promise<DailyBar[]>`
  - `insertSnapshot(snapshot: ScanSnapshot): Promise<string | null>` — returns generated snapshot UUID or null on failure
  - `insertScanRows(snapshotId: string, snapshot: ScanSnapshot): Promise<void>`
  - `isClickhouseEnabled(): boolean`

All methods silently no-op and log via `console.warn` on error. Never throw.

- [ ] **Step 1: Add the dependency**

Run:

```bash
npm install @clickhouse/client
```

- [ ] **Step 2: Create the client module**

Create `src/lib/data/clickhouse.ts` with this content:

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`

Expected: build completes without TypeScript errors. If it complains about missing fields on `ScanRow` (e.g., `pUp`, `mu`, `modelEdge`), open `src/lib/engine/types.ts` to confirm exact property names and update `insertScanRows` accordingly.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new lint errors in `src/lib/data/clickhouse.ts`.

- [ ] **Step 5: Verify no-op path (env unset)**

In a scratch REPL or via a one-shot script, confirm `isClickhouseEnabled()` returns `false` when `CLICKHOUSE_URL` is not set. Simplest check — run:

```bash
node -e "process.env.CLICKHOUSE_URL=''; require('./.next/server/chunks/clickhouse').isClickhouseEnabled?.() ?? console.log('unset ->', require('@clickhouse/client'))"
```

If the built output isn't accessible, skip this step and rely on the boot verification in Task 6.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/data/clickhouse.ts
git commit -m "feat(data): ClickHouse client with fail-open no-op contract"
```

---

## Task 4: Integrate CH as L2 bar cache in `bars.ts`

**Files:**
- Modify: `src/lib/data/bars.ts` (add CH read after L1 miss, CH write after Alpaca fetch, in both `fetchDailyBars` and `fetchIntradayBars`)

**Interfaces:**
- Consumes: `insertBars`, `queryBars`, `isClickhouseEnabled` from `./clickhouse`.
- Produces: same public signatures for `fetchDailyBars` and `fetchIntradayBars` — behaviour change only.

**Design notes for the implementer:**
- L1 → L2 → Alpaca is per-symbol logic. The batch-fetch shape from Alpaca (up to 100 symbols/request) is a network optimisation; splitting per-symbol for L2 is fine because CH queries are cheap.
- Only fetch from Alpaca the symbols where CH returned insufficient data (fewer bars than expected for the range).
- Write back to CH the newly-fetched Alpaca bars only. Do not re-write bars that already came from CH.
- For daily bars, "insufficient" means fewer than `lookbackDays * 0.6` distinct calendar days (matches the existing `data.py:273 — days * 1.6` slack).
- For intraday bars with a 60s TTL, CH will usually be a hit for anything ≥ ~1 minute old. Anything within the last minute usually needs a fresh Alpaca fetch.

- [ ] **Step 1: Import CH helpers at top of `bars.ts`**

Add near the top of the imports section:

```ts
import { insertBars, queryBars, isClickhouseEnabled } from "./clickhouse";
```

- [ ] **Step 2: Add L2 lookup helper**

After the `chunk` helper (around line 116) and before the cache section, add:

```ts
// Threshold for "enough" bars from L2 before we skip Alpaca for a symbol.
// Matches the *0.6 slack the Alpaca fetch already tolerates (data.py:273).
function enoughDailyFromL2(bars: DailyBar[], lookbackDays: number): boolean {
  return bars.length >= Math.floor(lookbackDays * 0.6);
}
function enoughIntradayFromL2(bars: IntradayBar[], lookbackMin: number, timeframe: IntradayTimeframe): boolean {
  const barMin = timeframe === "1Min" ? 1 : 5;
  const expected = Math.floor(lookbackMin / barMin);
  // Intraday is stricter: require at least 80% of expected bars before trusting L2.
  return bars.length >= Math.floor(expected * 0.8);
}
```

- [ ] **Step 3: Add L2 layer to `fetchDailyBars`**

Locate `fetchDailyBars` (around line 147). After the L1 hit check (`if (cached && …) return cached.bars;`) and before the `const result = new Map…` block, insert:

```ts
  // L2: ClickHouse. Pull whatever CH has for each symbol in the window.
  const l2Result = new Map<string, DailyBar[]>();
  const needFromAlpaca: string[] = [];
  if (isClickhouseEnabled()) {
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    for (const sym of symbols) {
      const rows = await queryBars(sym, "1Day", startISO, endISO);
      if (enoughDailyFromL2(rows, lookbackDays)) {
        l2Result.set(sym, rows);
      } else {
        needFromAlpaca.push(sym);
      }
    }
  } else {
    needFromAlpaca.push(...symbols);
  }
```

Then change the Alpaca fetch loop to use `needFromAlpaca` instead of `symbols`, and merge L2 hits into the final result. Replace:

```ts
  const result = new Map<string, DailyBar[]>();
  try {
    for (const group of chunk(symbols, 100)) {
      await pullBars(group, "1Day", start, end, result);
    }
  } catch {
    // Fail-open: return whatever (possibly empty) we managed to gather.
    return result.size > 0 ? result : new Map();
  }
```

with:

```ts
  const result = new Map<string, DailyBar[]>(l2Result);
  if (needFromAlpaca.length > 0) {
    const fresh = new Map<string, DailyBar[]>();
    try {
      for (const group of chunk(needFromAlpaca, 100)) {
        await pullBars(group, "1Day", start, end, fresh);
      }
    } catch {
      // Fail-open: return whatever (possibly empty) we managed to gather.
      if (result.size === 0 && fresh.size === 0) return new Map();
    }
    // Write fresh Alpaca bars back to CH (fire-and-forget) and merge.
    for (const [sym, bars] of fresh) {
      result.set(sym, bars);
      if (isClickhouseEnabled()) {
        void insertBars(sym, "1Day", bars);
      }
    }
  }
```

- [ ] **Step 4: Add L2 layer to `fetchIntradayBars`**

Locate `fetchIntradayBars` (around line 183). Apply the same pattern:

After the L1 hit check, insert:

```ts
  const l2Result = new Map<string, IntradayBar[]>();
  const needFromAlpaca: string[] = [];
  if (isClickhouseEnabled()) {
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    for (const sym of symbols) {
      const rows = (await queryBars(sym, timeframe, startISO, endISO)) as IntradayBar[];
      if (enoughIntradayFromL2(rows, lookbackMin, timeframe)) {
        l2Result.set(sym, rows);
      } else {
        needFromAlpaca.push(sym);
      }
    }
  } else {
    needFromAlpaca.push(...symbols);
  }
```

Replace the existing Alpaca fetch block with:

```ts
  const result = new Map<string, IntradayBar[]>(l2Result);
  if (needFromAlpaca.length > 0) {
    const fresh = new Map<string, IntradayBar[]>();
    try {
      for (const group of chunk(needFromAlpaca, 100)) {
        await pullBars(group, timeframe, start, end, fresh);
      }
    } catch {
      if (result.size === 0 && fresh.size === 0) return new Map();
    }
    for (const [sym, bars] of fresh) {
      result.set(sym, bars);
      if (isClickhouseEnabled()) {
        void insertBars(sym, timeframe, bars);
      }
    }
  }
```

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors. If `pullBars` has a `Map<string, DailyBar[]>` sink type that clashes with the intraday callsite, either cast the map at the call point or generalise `pullBars`'s sink type parameter — but do not change its runtime behaviour.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no new lint errors in `src/lib/data/bars.ts`.

- [ ] **Step 7: Boot verification (CH unset)**

Temporarily unset CH env, boot the app in dev, hit `/dashboard` once, and confirm the scan still runs. Run:

```bash
CLICKHOUSE_URL= npm run dev
```

Expected: no crashes, no `[clickhouse]` warnings besides potentially an init-time noop. The scan completes.

- [ ] **Step 8: Commit**

```bash
git add src/lib/data/bars.ts
git commit -m "feat(bars): CH as L2 cache with Alpaca gap-fill"
```

---

## Task 5: Fire-and-forget scan snapshot writes in `scanner.ts`

**Files:**
- Modify: `src/lib/engine/scanner.ts` (add CH imports + fire-and-forget write in `getLatestSnapshot`)

**Interfaces:**
- Consumes: `insertSnapshot`, `insertScanRows`, `isClickhouseEnabled` from `@/lib/data/clickhouse`.
- Produces: no new exports. Side effect: each newly-computed snapshot is written to CH.

**Design note:** The hook is inside `getLatestSnapshot` right after `entry.snapshot = snap;` — this fires *once per genuinely new scan*, not per SSE tick.

- [ ] **Step 1: Import CH helpers**

Near the top of `src/lib/engine/scanner.ts`, add:

```ts
import { insertSnapshot, insertScanRows, isClickhouseEnabled } from "@/lib/data/clickhouse";
```

- [ ] **Step 2: Add the persist helper**

After the `resolveHorizon` function (around line 478) and before `getLatestSnapshot`, add:

```ts
// Fire-and-forget CH write for a fresh snapshot. Never blocks the scan path;
// swallowed errors are already logged inside the clickhouse module.
function persistSnapshotAsync(snap: ScanSnapshot): void {
  if (!isClickhouseEnabled()) return;
  void insertSnapshot(snap).then((id) => {
    if (id) return insertScanRows(id, snap);
  });
}
```

- [ ] **Step 3: Wire the persist call into `getLatestSnapshot`**

Locate the `refresh(horizon).then(...)` block inside `getLatestSnapshot` (around line 493). Change:

```ts
  entry.inflight = refresh(horizon).then((snap) => {
    entry.snapshot = snap;
    entry.ts = Date.now();
    entry.inflight = null;
    return snap;
  }).catch((err) => {
    entry.inflight = null;
    throw err;
  });
```

to:

```ts
  entry.inflight = refresh(horizon).then((snap) => {
    entry.snapshot = snap;
    entry.ts = Date.now();
    entry.inflight = null;
    persistSnapshotAsync(snap);
    return snap;
  }).catch((err) => {
    entry.inflight = null;
    throw err;
  });
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/scanner.ts
git commit -m "feat(scanner): fire-and-forget scan snapshot writes to ClickHouse"
```

---

## Task 6: End-to-end boot verification

**Files:** none modified — this task validates the whole stack.

**Interfaces:** none.

- [ ] **Step 1: Bring the whole stack up**

Run:

```bash
docker compose up -d --build
```

Wait ~30s for postgres + clickhouse + fundamentals health checks.

- [ ] **Step 2: Confirm all four services are healthy**

Run: `docker compose ps`
Expected: `singscanner-pg`, `singscanner-ch`, `singscanner-fundamentals`, `singscanner-app` all show status `Up` and health `healthy` (where applicable).

- [ ] **Step 3: Hit the dashboard once to trigger a scan**

In a browser: `http://localhost:3097/dashboard`. Wait until at least one scan snapshot arrives (star column populated on BUY picks).

- [ ] **Step 4: Verify bars are being written to CH**

Run:

```bash
docker exec singscanner-ch clickhouse-client --query "SELECT count() FROM singscanner.bars"
```

Expected: a non-zero number (should be at least a few thousand for a 600-symbol universe with ~90 days of daily bars).

- [ ] **Step 5: Verify snapshots are being written**

Run:

```bash
docker exec singscanner-ch clickhouse-client --query "SELECT count(), max(generated_at) FROM singscanner.scan_snapshots"
```

Expected: count ≥ 1, `max(generated_at)` within the last minute.

- [ ] **Step 6: Verify per-row scores are being written**

Run:

```bash
docker exec singscanner-ch clickhouse-client --query "SELECT count(), countIf(star = 1) FROM singscanner.scan_rows"
```

Expected: total row count ≈ 600 × number_of_snapshots, and `countIf(star = 1)` = 5 × number_of_snapshots (top 5 per scan).

- [ ] **Step 7: Verify L2 warm-cache path works**

Restart just the app container (bars L1 is in-memory so it drops):

```bash
docker compose restart app
```

Then hit the dashboard again. Check `docker logs singscanner-app | tail -100` — you should see no `alpaca bars failed` and the scan should complete faster than the very first run (bars are being served from CH now, not re-fetched from Alpaca).

- [ ] **Step 8: Verify CH-down fallback**

Stop CH:

```bash
docker compose stop clickhouse
```

Wait ~15s, then hit the dashboard again. Confirm the scan still completes (falls back to Alpaca-only). Logs should show `[clickhouse] ... failed:` warnings but the scan snapshot arrives on the client. Then restart CH:

```bash
docker compose start clickhouse
```

- [ ] **Step 9: No commit for this task**

This task is validation only — no code changes.

---

## Self-review

**Spec coverage:**
- ✅ Universe 100/300 → 600 (Task 1)
- ✅ ClickHouse schema for bars + snapshots + rows (Task 2)
- ✅ TypeScript CH client with fail-open no-op (Task 3)
- ✅ L2 bar cache in the hot read path with Alpaca gap-fill (Task 4)
- ✅ Fire-and-forget snapshot + row writes (Task 5)
- ✅ Fallback guarantee validated end-to-end (Task 6)
- ✅ New files: `src/lib/data/clickhouse.ts`, `services/clickhouse/init/01_schema.sql`
- ✅ Modified files: `scanner.ts`, `bars.ts`, `docker-compose.yml`, `package.json`

**Placeholder scan:** No TBDs, no "handle appropriately". Task 3 Step 5 has a soft fallback ("skip if the built output isn't accessible") because the no-op path is also covered by Task 6 Step 8 — that's a validation redundancy, not a placeholder.

**Type consistency:** `BarTimeframe` union is defined once in `clickhouse.ts` and reused via the `timeframe` parameter. `DailyBar[]` and `IntradayBar[]` share the same shape (`{t,o,h,l,c,v,vw?}`) so `queryBars` returning `DailyBar[]` and being cast to `IntradayBar[]` in Task 4 is safe. The `ScanRow` field names used in `insertScanRows` (`pUp`, `mu`, `modelEdge`) match those already in `src/lib/engine/types.ts` (confirmed via ActionableDashboard's usage: `row.pUp`, `row.mu`, `row.modelEdge`).
