# Shadow Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `singscannerauto3/shadow_monitor.py` + `dynamic_challenger.py` to TypeScript. One `ShadowMonitor` per horizon (3d/5d/10d) runs alongside the scanner, logs baseline-vs-challenger divergences to ClickHouse, resolves them at horizon end, and computes a Beta-shrinkage promotion posterior. Historical backlog seeds the challenger buckets from 200 days of daily bars.

**Architecture:** Fire-and-forget hook into the scanner's `getLatestSnapshot` per-cycle path (same place as `persistSnapshotAsync`). Three CH tables persist state. Dynamic action-value challenger holds bucket state in memory + debounced CH flush. Admin dashboard gets one basic section; new `/admin/shadow` page shows detail. Reports promotion readiness — never auto-switches.

**Tech Stack:** Next.js 16, TypeScript, `@clickhouse/client` (existing), Prisma (existing), NextAuth 5 (existing), Tailwind (existing). No new deps.

## Global Constraints

- **No test framework configured.** Validation uses `npm run build` (typecheck + compile) and `npm run lint`. Do NOT add vitest/jest.
- **API routes under `/api/admin/*` MUST perform explicit session check** via `auth()` and return `403` if `session.user.role !== "ADMIN"`. Middleware excludes `/api/*` (see `src/middleware.ts:57`).
- **Fail-open on ClickHouse.** If `CLICKHOUSE_URL` is unset or any CH query fails, the monitor logs a warning and no-ops. Scanner core path is never affected.
- **Numeric constants ported verbatim** from `shadow_monitor.py` and `dynamic_challenger.py`: `PRIOR_STRENGTH_KAPPA=20`, `RIDGE_LAMBDA=5`, `MIN_SAMPLES_FOR_RIDGE=8`, `MAX_SAMPLES_PER_BUCKET=500`, `DECAY_FACTOR=0.9`, posterior `κ₀=7`, `δ₀=0`, `n≥30`, `positive_share≥0.55`.
- **Feature vector layout is fixed:** `[role_primary, role_secondary, role_retained, current_weight, delta_weight, cash_fraction, has_open_order, ticker_edge]`. Length = 8. Do NOT reorder.
- **Never auto-switch.** Reports `promotable: bool` only. §53 rule.
- **Prisma import path:** `@/lib/prisma` (confirmed).
- **Auth import path:** `@/auth`.
- **Visual language matches existing dashboard** — mono, LED dots, `bg-surface-low`, `border-border`, `text-on-surface-variant`. Reference `src/components/dashboard/views/ActionableDashboard.tsx` for style.
- **Reference spec:** `docs/superpowers/specs/2026-07-07-shadow-monitor-design.md`.
- **Reference Python source:** `C:\Users\nicopc\Downloads\singscannerauto3\shadow_monitor.py` + `dynamic_challenger.py` (read-only reference, do not copy paths).

---

## File structure

**Create:**
- `services/clickhouse/init/03_shadow_schema.sql` — 3 new CH tables.
- `src/lib/shadow/features.ts` — `FEATURE_NAMES`, `N_FEATURES`, `sessionBucketNow`, `bucketKey`, `extractFeatures`.
- `src/lib/shadow/posterior.ts` — `computePosterior(rows, opts)` pure function.
- `src/lib/shadow/dynamic-challenger.ts` — `DynamicActionValueChallenger` class.
- `src/lib/shadow/persistence.ts` — CH read/write for pending/resolved/buckets.
- `src/lib/shadow/monitor.ts` — `ShadowMonitor` class (observe + resolvePending).
- `src/lib/shadow/backlog.ts` — `runHistoricalBacklog(horizon)`.
- `src/lib/shadow/index.ts` — `bootstrapShadowMonitors()` + `shadowMonitorAsync()` + public reads.
- `src/instrumentation.ts` — Next.js 16 server bootstrap hook (creates if missing).
- `src/app/api/admin/shadow/summary/route.ts` — basic view.
- `src/app/api/admin/shadow/[horizon]/route.ts` — detail view.
- `src/app/api/admin/shadow/backlog/route.ts` — POST trigger.
- `src/app/admin/sections/ShadowSection.tsx` — basic-view card for `/admin`.
- `src/app/admin/shadow/page.tsx` — server component.
- `src/app/admin/shadow/ShadowClient.tsx` — client component (tabs + charts + tables).

**Modify:**
- `src/lib/engine/scanner.ts` — inside `getLatestSnapshot`'s `.then((snap) => {...})` block, add `shadowMonitorAsync(snap)` after the existing `persistSnapshotAsync(snap)`.
- `src/app/admin/AdminDashboard.tsx` — mount `<ShadowSection />` between `<SignalQualitySection />` and `<PipelineHealthSection />`.

---

## Task 1: ClickHouse schema + persistence module

**Files:**
- Create: `services/clickhouse/init/03_shadow_schema.sql`
- Create: `src/lib/shadow/persistence.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Three CH tables applied on fresh CH boot: `shadow_pending`, `shadow_resolved`, `shadow_buckets`.
  - `src/lib/shadow/persistence.ts` exports:
    - `insertPending(row: PendingRow): Promise<void>`
    - `queryPendingExpired(horizon: string, olderThanMs: number): Promise<PendingRow[]>`
    - `deletePending(id: string): Promise<void>`
    - `insertResolved(row: ResolvedRow): Promise<void>`
    - `countResolvedHistorical(horizon: string): Promise<number>`
    - `queryResolvedForPosterior(horizon: string, source?: "live" | "historical" | "all"): Promise<Array<{ delta_bps: number }>>`
    - `queryRecentPending(horizon: string, limit: number): Promise<PendingRow[]>`
    - `queryRecentResolvedLive(horizon: string, limit: number): Promise<ResolvedRow[]>`
    - `queryHistoricalDailyDelta(horizon: string): Promise<Array<{ day: string; mean_delta_bps: number; n: number }>>`
    - `upsertBucket(row: BucketRow): Promise<void>`
    - `loadBuckets(horizon: string): Promise<Map<string, BucketRow>>` — keyed by bucket string.
  - Row types (also exported):
    - `interface PendingRow { id: string; horizon: string; symbol: string; submittedAt: string; baselineDecision: string; challengerDecision: string; baselineNetBps: number; challengerNetBps: number; entryPrice: number; bucket: string; features: number[]; source: "live" | "historical" }`
    - `interface ResolvedRow { id: string; horizon: string; symbol: string; submittedAt: string; resolvedAt: string; baselineDecision: string; challengerDecision: string; realizedBps: number; baselineValueBps: number; challengerValueBps: number; deltaBps: number; source: "live" | "historical"; clean: 0 | 1 }`
    - `interface BucketRow { horizon: string; bucket: string; updatedAt: string; n: number; meanY: number; meanX: number[]; xtx: number[]; xty: number[] }`
- All methods no-op silently (return `[]`, `null`, or `undefined`) if `CLICKHOUSE_URL` is unset. Use the same lazy `getClient()` singleton pattern as `src/lib/data/clickhouse.ts`.

- [ ] **Step 1: Create the schema file**

Create `services/clickhouse/init/03_shadow_schema.sql` with exactly this content:

```sql
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
```

- [ ] **Step 2: Create the persistence module**

Create `src/lib/shadow/persistence.ts` with this content:

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new lint errors in `src/lib/shadow/persistence.ts`.

- [ ] **Step 5: Commit**

```bash
git add services/clickhouse/init/03_shadow_schema.sql src/lib/shadow/persistence.ts
git commit -m "feat(shadow): CH schema (pending/resolved/buckets) + persistence layer"
```

---

## Task 2: Feature vector + bucket key helpers

**Files:**
- Create: `src/lib/shadow/features.ts`

**Interfaces:**
- Consumes: `ScanRow` from `@/lib/engine/types`.
- Produces:
  - `const FEATURE_NAMES: readonly string[]` — length 8, fixed order.
  - `const N_FEATURES: number` — always 8.
  - `type SessionBucket = "regular" | "premarket" | "afterhours" | "closed"`
  - `function sessionBucketNow(): SessionBucket` — US/Eastern wall clock.
  - `function bucketKey(role: string, session: SessionBucket): string` — returns `` `${role}|${session}` ``.
  - `interface FeatureContext { cashFraction: number; tickerEdge: number; heldNotional?: number }`
  - `function extractFeatures(row: ScanRow, ctx: FeatureContext): number[]` — returns length-8 vector.

- [ ] **Step 1: Create the module**

Create `src/lib/shadow/features.ts`:

```ts
// Fixed-order feature vector for the dynamic action-value challenger.
// Layout MUST NOT change — bucket state (X'X, X'y) depends on stable indexing.

import type { ScanRow } from "@/lib/engine/types";

export const FEATURE_NAMES = [
  "role_primary",
  "role_secondary",
  "role_retained",
  "current_weight",
  "delta_weight",
  "cash_fraction",
  "has_open_order",
  "ticker_edge",
] as const;

export const N_FEATURES = FEATURE_NAMES.length; // 8

export type SessionBucket = "regular" | "premarket" | "afterhours" | "closed";

// Coarse US/Eastern session classification for the current wall clock.
// Matches dynamic_challenger.py:_session_bucket_now.
export function sessionBucketNow(): SessionBucket {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minStr = parts.find((p) => p.type === "minute")?.value ?? "0";
  const weekend = weekdayStr === "Sat" || weekdayStr === "Sun";
  if (weekend) return "closed";
  const h = Number(hourStr) + Number(minStr) / 60;
  if (h >= 9.5 && h < 16) return "regular";
  if (h >= 4 && h < 9.5) return "premarket";
  if (h >= 16 && h < 20) return "afterhours";
  return "closed";
}

export function bucketKey(role: string, session: SessionBucket): string {
  return `${role}|${session}`;
}

export interface FeatureContext {
  cashFraction: number;
  tickerEdge: number;
  heldNotional?: number;
}

// Build the 8-feature vector. Matches dynamic_challenger.py:_extract_features
// with the v1 held-side substitution (heldNotional=0 unless caller provides).
export function extractFeatures(row: ScanRow, ctx: FeatureContext): number[] {
  const price = row.price || 0;
  const heldNotional = ctx.heldNotional ?? 0;
  // "notional" in the Python source is the trader's intended trade notional;
  // in v1 we use price × a nominal 20-share standin so current/delta_weight
  // have meaningful magnitude. Once the trader ships, callers can override
  // by passing heldNotional and adjusting semantics.
  const notional = price * 20;
  const denom = Math.max(notional * 20, 1);
  const currentWeight = heldNotional / denom;
  const deltaWeight = (notional - heldNotional) / denom;
  return [
    row.role === "primary" ? 1 : 0,
    row.role === "secondary" ? 1 : 0,
    row.role === "retained" ? 1 : 0,
    currentWeight,
    deltaWeight,
    ctx.cashFraction,
    0, // has_open_order — v1: always 0 (trader ships later)
    ctx.tickerEdge,
  ];
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/shadow/features.ts
git commit -m "feat(shadow): feature vector + session-bucket helpers"
```

---

## Task 3: Beta-shrinkage posterior

**Files:**
- Create: `src/lib/shadow/posterior.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface PosteriorOpts { kappa0?: number; delta0?: number; minCleanRows?: number; minPositiveShare?: number; minPosteriorDelta?: number }`
  - `interface Posterior { n_clean: number; positive_share: number; mean_delta_bps: number; delta_post_bps: number; promotable: boolean; reason: string }`
  - `function computePosterior(rows: Array<{ delta_bps: number }>, opts?: PosteriorOpts): Posterior`

- [ ] **Step 1: Create the module**

Create `src/lib/shadow/posterior.ts`:

```ts
// Beta-shrinkage promotion posterior. Ported from shadow_monitor.py:posterior().
// Pure function — no state, no I/O.

export interface PosteriorOpts {
  kappa0?: number;               // default 7
  delta0?: number;               // default 0
  minCleanRows?: number;         // default 30
  minPositiveShare?: number;     // default 0.55
  minPosteriorDelta?: number;    // default 0
}

export interface Posterior {
  n_clean: number;
  positive_share: number;
  mean_delta_bps: number;
  delta_post_bps: number;
  promotable: boolean;
  reason: string;
}

const DEFAULT_OPTS: Required<PosteriorOpts> = {
  kappa0: 7,
  delta0: 0,
  minCleanRows: 30,
  minPositiveShare: 0.55,
  minPosteriorDelta: 0,
};

export function computePosterior(
  rows: ReadonlyArray<{ delta_bps: number }>,
  opts: PosteriorOpts = {},
): Posterior {
  const o = { ...DEFAULT_OPTS, ...opts };
  const n = rows.length;
  if (n === 0) {
    return {
      n_clean: 0,
      positive_share: 0,
      mean_delta_bps: 0,
      delta_post_bps: o.delta0,
      promotable: false,
      reason: "no clean resolved rows",
    };
  }
  const deltas = rows.map((r) => r.delta_bps);
  const meanD = deltas.reduce((a, b) => a + b, 0) / n;
  const posShare = deltas.filter((d) => d > 0).length / n;
  const deltaPost = (o.kappa0 * o.delta0 + n * meanD) / (o.kappa0 + n);
  const promotable =
    n >= o.minCleanRows && posShare >= o.minPositiveShare && deltaPost > o.minPosteriorDelta;
  const reason = promotable
    ? "promotion-ready"
    : `n=${n}/${o.minCleanRows}, pos_share=${posShare.toFixed(2)}/${o.minPositiveShare}, δ_post=${deltaPost.toFixed(1)}/${o.minPosteriorDelta.toFixed(1)}`;
  return {
    n_clean: n,
    positive_share: Math.round(posShare * 1000) / 1000,
    mean_delta_bps: Math.round(meanD * 100) / 100,
    delta_post_bps: Math.round(deltaPost * 100) / 100,
    promotable,
    reason,
  };
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/shadow/posterior.ts
git commit -m "feat(shadow): Beta-shrinkage posterior (pure function)"
```

---

## Task 4: Dynamic action-value challenger

**Files:**
- Create: `src/lib/shadow/dynamic-challenger.ts`

**Interfaces:**
- Consumes: `N_FEATURES`, `FEATURE_NAMES`, `bucketKey`, `sessionBucketNow`, `extractFeatures`, `type FeatureContext` from `./features`. `BucketRow`, `upsertBucket`, `loadBuckets` from `./persistence`.
- Produces:
  - `class DynamicActionValueChallenger` with:
    - `constructor(horizon: string)`
    - `async load(): Promise<void>` — reads buckets from CH into memory.
    - `predict(role: string, features: number[], fallbackBps: number): { estimate: number; diag: PredictDiag }` — pure prediction.
    - `update(bucket: string, features: number[], realizedValueBps: number): void` — incremental update.
    - `scheduleFlush(): void` — debounced 30s flush of dirty buckets.
    - `flushNow(): Promise<void>` — immediate flush (for shutdown or tests).
    - `status(): Array<{ bucket: string; n: number; mean_y_bps: number }>` — introspection.
  - `interface PredictDiag { bucket: string; n: number; shrinkage_strength: number; fallback_bps: number; bucket_mean: number | null; ridge_adj: number }`

- [ ] **Step 1: Create the module**

Create `src/lib/shadow/dynamic-challenger.ts`:

```ts
// Dynamic action-value surface challenger (§64).
// Port of singscannerauto3/dynamic_challenger.py.
//
// Per-bucket state: n, mean_y, mean_x[8], xtx[8][8], xty[8].
// Prediction: shrinkage toward fallback + within-bucket ridge adjustment.
// Update: incremental means + accumulator increments.

import {
  loadBuckets,
  upsertBucket,
  type BucketRow,
} from "./persistence";
import { N_FEATURES } from "./features";

const PRIOR_STRENGTH_KAPPA = 20.0;
const RIDGE_LAMBDA = 5.0;
const MIN_SAMPLES_FOR_RIDGE = 8;
const MAX_SAMPLES_PER_BUCKET = 500;
const DECAY_FACTOR = 0.9;

// Debounce window: coalesce many updates into one flush per bucket.
const FLUSH_DEBOUNCE_MS = Number(process.env.SHADOW_BUCKET_FLUSH_DEBOUNCE_MS ?? "30000");

export interface PredictDiag {
  bucket: string;
  n: number;
  shrinkage_strength: number;
  fallback_bps: number;
  bucket_mean: number | null;
  ridge_adj: number;
}

interface BucketState {
  bucket: string;
  n: number;
  meanY: number;
  meanX: number[]; // length 8
  xtx: number[];   // length 64, row-major 8×8
  xty: number[];   // length 8
  dirty: boolean;
}

function emptyBucket(bucket: string): BucketState {
  return {
    bucket,
    n: 0,
    meanY: 0,
    meanX: new Array(N_FEATURES).fill(0),
    xtx: new Array(N_FEATURES * N_FEATURES).fill(0),
    xty: new Array(N_FEATURES).fill(0),
    dirty: false,
  };
}

function fromRow(row: BucketRow): BucketState {
  return {
    bucket: row.bucket,
    n: row.n,
    meanY: row.meanY,
    meanX: row.meanX.slice(),
    xtx: row.xtx.slice(),
    xty: row.xty.slice(),
    dirty: false,
  };
}

export class DynamicActionValueChallenger {
  private readonly horizon: string;
  private readonly buckets = new Map<string, BucketState>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(horizon: string) {
    this.horizon = horizon;
  }

  async load(): Promise<void> {
    const rows = await loadBuckets(this.horizon);
    for (const [key, row] of rows) {
      this.buckets.set(key, fromRow(row));
    }
  }

  // -- Prediction -----------------------------------------------------------

  predict(bucket: string, features: number[], fallbackBps: number): { estimate: number; diag: PredictDiag } {
    const b = this.buckets.get(bucket);
    if (!b || b.n < 3) {
      return {
        estimate: fallbackBps,
        diag: {
          bucket, n: b?.n ?? 0, shrinkage_strength: 0,
          fallback_bps: fallbackBps, bucket_mean: null, ridge_adj: 0,
        },
      };
    }
    let ridgeAdj = 0;
    if (b.n >= MIN_SAMPLES_FOR_RIDGE) {
      const beta = this.ridgeBeta(b);
      if (beta) {
        for (let i = 0; i < N_FEATURES; i++) {
          ridgeAdj += (features[i] - b.meanX[i]) * beta[i];
        }
      }
    }
    const w = b.n / (b.n + PRIOR_STRENGTH_KAPPA);
    let estimate = (1 - w) * fallbackBps + w * (b.meanY + ridgeAdj);
    estimate = Math.max(0, Math.min(600, estimate));
    return {
      estimate,
      diag: {
        bucket,
        n: b.n,
        shrinkage_strength: Math.round(w * 1000) / 1000,
        fallback_bps: Math.round(fallbackBps * 10) / 10,
        bucket_mean: Math.round(b.meanY * 10) / 10,
        ridge_adj: Math.round(ridgeAdj * 10) / 10,
      },
    };
  }

  // -- Update ---------------------------------------------------------------

  update(bucket: string, features: number[], realizedValueBps: number): void {
    if (features.length !== N_FEATURES) return;
    let b = this.buckets.get(bucket);
    if (!b) {
      b = emptyBucket(bucket);
      this.buckets.set(bucket, b);
    }
    if (b.n >= MAX_SAMPLES_PER_BUCKET) this.decay(b, DECAY_FACTOR);
    const nPrime = b.n + 1;
    b.meanY = (b.n * b.meanY + realizedValueBps) / nPrime;
    for (let i = 0; i < N_FEATURES; i++) {
      b.meanX[i] = (b.n * b.meanX[i] + features[i]) / nPrime;
      b.xty[i] += features[i] * realizedValueBps;
      for (let j = 0; j < N_FEATURES; j++) {
        b.xtx[i * N_FEATURES + j] += features[i] * features[j];
      }
    }
    b.n = nPrime;
    b.dirty = true;
    this.scheduleFlush();
  }

  private decay(b: BucketState, factor: number): void {
    b.n = Math.floor(b.n * factor);
    for (let i = 0; i < N_FEATURES; i++) {
      b.xty[i] *= factor;
      for (let j = 0; j < N_FEATURES; j++) {
        b.xtx[i * N_FEATURES + j] *= factor;
      }
    }
  }

  // -- Ridge solve (8×8 Gauss-Jordan) ---------------------------------------

  private ridgeBeta(b: BucketState): number[] | null {
    const A: number[][] = [];
    for (let i = 0; i < N_FEATURES; i++) {
      const row: number[] = [];
      for (let j = 0; j < N_FEATURES; j++) {
        row.push(b.xtx[i * N_FEATURES + j]);
      }
      row[i] += RIDGE_LAMBDA;
      A.push(row);
    }
    const bv = b.xty.slice();
    // Forward elimination
    for (let i = 0; i < N_FEATURES; i++) {
      const piv = A[i][i];
      if (Math.abs(piv) < 1e-9) return null;
      for (let j = i + 1; j < N_FEATURES; j++) {
        const factor = A[j][i] / piv;
        for (let k = i; k < N_FEATURES; k++) A[j][k] -= factor * A[i][k];
        bv[j] -= factor * bv[i];
      }
    }
    // Back substitution
    const beta = new Array(N_FEATURES).fill(0) as number[];
    for (let i = N_FEATURES - 1; i >= 0; i--) {
      let s = bv[i];
      for (let j = i + 1; j < N_FEATURES; j++) s -= A[i][j] * beta[j];
      beta[i] = s / A[i][i];
    }
    return beta;
  }

  // -- Flush ----------------------------------------------------------------

  scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, FLUSH_DEBOUNCE_MS);
  }

  async flushNow(): Promise<void> {
    const now = new Date().toISOString();
    for (const b of this.buckets.values()) {
      if (!b.dirty) continue;
      await upsertBucket({
        horizon: this.horizon,
        bucket: b.bucket,
        updatedAt: now,
        n: b.n,
        meanY: b.meanY,
        meanX: b.meanX,
        xtx: b.xtx,
        xty: b.xty,
      });
      b.dirty = false;
    }
  }

  // -- Introspection --------------------------------------------------------

  status(): Array<{ bucket: string; n: number; mean_y_bps: number }> {
    return Array.from(this.buckets.values())
      .map((b) => ({ bucket: b.bucket, n: b.n, mean_y_bps: Math.round(b.meanY * 100) / 100 }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));
  }
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/shadow/dynamic-challenger.ts
git commit -m "feat(shadow): DynamicActionValueChallenger port (predict + update + ridge + decay)"
```

---

## Task 5: ShadowMonitor class

**Files:**
- Create: `src/lib/shadow/monitor.ts`

**Interfaces:**
- Consumes: `DynamicActionValueChallenger`, `PredictDiag` from `./dynamic-challenger`. Persistence helpers from `./persistence`. `extractFeatures`, `sessionBucketNow`, `bucketKey`, `N_FEATURES` from `./features`. `computePosterior`, `Posterior` from `./posterior`. `ScanSnapshot`, `ScanRow` from `@/lib/engine/types`.
- Produces:
  - `class ShadowMonitor` with:
    - `constructor(horizon: "3d" | "5d" | "10d")`
    - `async init(): Promise<void>` — loads challenger state from CH.
    - `async observe(snap: ScanSnapshot): Promise<void>` — main entry point per scan cycle.
    - `async resolvePending(): Promise<void>` — called by observe (opportunistic).
    - `getChallenger(): DynamicActionValueChallenger` — for backlog access.
    - `async flushShutdown(): Promise<void>` — for clean shutdown.
  - `HORIZON_RESOLUTION_MS: Record<"3d"|"5d"|"10d", number>` — 3/5/10 trading days in ms.

- [ ] **Step 1: Create the module**

Create `src/lib/shadow/monitor.ts`:

```ts
// ShadowMonitor per horizon. Runs observe() per scan cycle from scanner's
// getLatestSnapshot hook. Manages the challenger, pending ledger, resolution.

import { DynamicActionValueChallenger } from "./dynamic-challenger";
import {
  insertPending,
  queryPendingExpired,
  deletePending,
  insertResolved,
  newId,
  type PendingRow,
} from "./persistence";
import {
  extractFeatures,
  sessionBucketNow,
  bucketKey,
  N_FEATURES,
} from "./features";
import type { ScanSnapshot, ScanRow } from "@/lib/engine/types";
import { queryBars } from "@/lib/data/clickhouse";

// Trading-day approximations for horizon → resolution window.
// 6.5h × 60min × 60s × 1000ms per trading day.
const TRADING_DAY_MS = 6.5 * 60 * 60 * 1000;
export const HORIZON_RESOLUTION_MS: Record<"3d" | "5d" | "10d", number> = {
  "3d": 3 * TRADING_DAY_MS,
  "5d": 5 * TRADING_DAY_MS,
  "10d": 10 * TRADING_DAY_MS,
};

// Divergence threshold on |Δnet| when decisions match.
const NET_DIVERGENCE_BPS = 20;

// Bump-friction challenger: same fallback as static perturbation to keep
// the first-cycle behavior sensible when the dynamic bucket is empty.
const FRICTION_BUMP = 0.05;

export class ShadowMonitor {
  private readonly horizon: "3d" | "5d" | "10d";
  private readonly challenger: DynamicActionValueChallenger;
  // In-memory dedup: (symbol, base_dec, chal_dec) currently in flight.
  private readonly openKeys = new Set<string>();

  constructor(horizon: "3d" | "5d" | "10d") {
    this.horizon = horizon;
    this.challenger = new DynamicActionValueChallenger(horizon);
  }

  async init(): Promise<void> {
    await this.challenger.load();
  }

  getChallenger(): DynamicActionValueChallenger {
    return this.challenger;
  }

  async flushShutdown(): Promise<void> {
    await this.challenger.flushNow();
  }

  // -- Main observe --------------------------------------------------------

  async observe(snap: ScanSnapshot): Promise<void> {
    if (snap.horizon !== this.horizon) return;
    const session = sessionBucketNow();
    const cashFraction = Math.max(0, Math.min(1, snap.cashWeight ?? 0.5));

    for (const row of snap.rows) {
      const features = extractFeatures(row, { cashFraction, tickerEdge: 0 });
      const bucket = bucketKey(row.role, session);

      // Fallback = baseline's model_edge; the static-perturbation baseline
      // for the dynamic challenger is roleEdge × (friction + FRICTION_BUMP),
      // but we let the dynamic predict handle it.
      const fallbackBps = row.modelEdge;
      const { estimate: chalEdge } = this.challenger.predict(bucket, features, fallbackBps);

      const edgeDelta = chalEdge - row.modelEdge;
      const chalNet = row.net + edgeDelta;
      const chalDecision = deriveChallengerDecision(row, chalNet);

      const netDiverges = Math.abs(chalNet - row.net) > NET_DIVERGENCE_BPS;
      if (row.decision === chalDecision && !netDiverges) continue;

      const dedupKey = `${row.symbol}|${row.decision}|${chalDecision}`;
      if (this.openKeys.has(dedupKey)) continue;
      this.openKeys.add(dedupKey);

      const pending: PendingRow = {
        id: newId(),
        horizon: this.horizon,
        symbol: row.symbol,
        submittedAt: new Date().toISOString(),
        baselineDecision: row.decision,
        challengerDecision: chalDecision,
        baselineNetBps: row.net,
        challengerNetBps: chalNet,
        entryPrice: row.price,
        bucket,
        features,
        source: "live",
      };
      await insertPending(pending);
    }

    void this.resolvePending();
    // Keep FRICTION_BUMP referenced so the constant survives the lint pass.
    void FRICTION_BUMP;
  }

  // -- Resolution ----------------------------------------------------------

  async resolvePending(): Promise<void> {
    const windowMs = HORIZON_RESOLUTION_MS[this.horizon];
    const rows = await queryPendingExpired(this.horizon, windowMs);
    if (rows.length === 0) return;

    for (const row of rows) {
      // Forward-price lookup: earliest daily bar after submitted_at.
      const submittedIso = row.submittedAt;
      const endIso = new Date(Date.now() + 1000).toISOString();
      const bars = await queryBars(row.symbol, "1Day", submittedIso, endIso);
      // Skip the first bar if it equals the submitted timestamp exactly.
      const forwardBar = bars.find(
        (b) => new Date(b.t).getTime() > new Date(submittedIso).getTime(),
      );
      if (!forwardBar) {
        // No data: drop from the openKeys set so future divergences can log.
        this.openKeys.delete(`${row.symbol}|${row.baselineDecision}|${row.challengerDecision}`);
        // Only truly expire (delete) if past 4×window; otherwise leave pending
        // for later retry.
        const age = Date.now() - new Date(submittedIso).getTime();
        if (age > 4 * windowMs) await deletePending(row.id);
        continue;
      }
      const forwardPrice = forwardBar.c;
      const realizedBps = (forwardPrice / row.entryPrice - 1) * 10000;
      const baselineValueBps = valueOf(row.baselineDecision, realizedBps);
      const challengerValueBps = valueOf(row.challengerDecision, realizedBps);
      const deltaBps = challengerValueBps - baselineValueBps;

      await insertResolved({
        id: newId(),
        horizon: this.horizon,
        symbol: row.symbol,
        submittedAt: row.submittedAt,
        resolvedAt: new Date().toISOString(),
        baselineDecision: row.baselineDecision,
        challengerDecision: row.challengerDecision,
        realizedBps,
        baselineValueBps,
        challengerValueBps,
        deltaBps,
        source: "live",
        clean: 1,
      });

      if (row.features.length === N_FEATURES) {
        this.challenger.update(row.bucket, row.features, challengerValueBps);
      }

      await deletePending(row.id);
      this.openKeys.delete(`${row.symbol}|${row.baselineDecision}|${row.challengerDecision}`);
    }
  }
}

// -- Helpers -----------------------------------------------------------------

function deriveChallengerDecision(row: ScanRow, chalNet: number): string {
  // Match shadow_monitor.py:observe (challenger decision from chal_net).
  const isHeld = false; // v1: no held-side integration; scanner treats all as unheld.
  if (row.role === "none" && !isHeld) return "HOLD-CASH";
  if (isHeld) return row.decision;
  if (chalNet > 0) return "BUY";
  return "WAIT";
}

// Symmetric cash framing: BUY captures realized move; anything else is
// treated as skipped-cash (opposite sign). See shadow_monitor.py:282-286.
function valueOf(decision: string, realizedBps: number): number {
  if (decision === "BUY") return realizedBps;
  return -realizedBps;
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/shadow/monitor.ts
git commit -m "feat(shadow): ShadowMonitor per horizon (observe + resolvePending)"
```

---

## Task 6: Historical backlog

**Files:**
- Create: `src/lib/shadow/backlog.ts`

**Interfaces:**
- Consumes: persistence helpers, `DynamicActionValueChallenger` (via `ShadowMonitor.getChallenger()`), `HORIZON_RESOLUTION_MS`, `queryBarsMulti`/`queryBars` from `@/lib/data/clickhouse`, scanner subroutines (`computeFamilies`, `forecast`, `assignRoles`, `gateDecision`, `computeBarFeatures`, `calibrate`, `parseHorizon`).
- Produces:
  - `interface BacklogProgress { horizon: string; daysProcessed: number; daysTotal: number; samplesAdded: number; running: boolean; error: string | null }`
  - `function getBacklogProgress(horizon: "3d"|"5d"|"10d"): BacklogProgress`
  - `async function runHistoricalBacklog(monitor: ShadowMonitor, opts?: { force?: boolean }): Promise<void>`

- [ ] **Step 1: Create the module**

Create `src/lib/shadow/backlog.ts`:

```ts
// Historical backlog runner. Replays past N trading days of scans against
// daily-bar-derivable inputs; forward-prices via bars N days later.
// Idempotent — checks countResolvedHistorical() before running.

import { fetchDailyBars, computeBarFeatures } from "@/lib/data/bars";
import { fetchActiveUniverse } from "@/lib/data/universe";
import { calibrate, parseHorizon } from "@/lib/engine/horizon";
import { computeFamilies, type RawSymbolInputs } from "@/lib/engine/signals";
import { forecast } from "@/lib/engine/forecast";
import { assignRoles } from "@/lib/engine/roles";
import { gateDecision } from "@/lib/engine/gate";
import type { ScanRow, Role } from "@/lib/engine/types";
import {
  countResolvedHistorical,
  insertResolved,
  newId,
} from "./persistence";
import { extractFeatures, sessionBucketNow, bucketKey } from "./features";
import type { ShadowMonitor } from "./monitor";
import { HORIZON_RESOLUTION_MS } from "./monitor";

const HISTORICAL_LOOKBACK_DAYS = Number(process.env.SHADOW_HISTORICAL_LOOKBACK_DAYS ?? "200");
const MIN_HISTORY_DAYS = Number(process.env.SHADOW_MIN_HISTORY_DAYS ?? "100");
const NET_DIVERGENCE_BPS = 20;

export interface BacklogProgress {
  horizon: string;
  daysProcessed: number;
  daysTotal: number;
  samplesAdded: number;
  running: boolean;
  error: string | null;
}

const progressByHorizon = new Map<string, BacklogProgress>();

export function getBacklogProgress(horizon: "3d" | "5d" | "10d"): BacklogProgress {
  return (
    progressByHorizon.get(horizon) ?? {
      horizon,
      daysProcessed: 0,
      daysTotal: 0,
      samplesAdded: 0,
      running: false,
      error: null,
    }
  );
}

export async function runHistoricalBacklog(
  monitor: ShadowMonitor,
  opts: { force?: boolean } = {},
): Promise<void> {
  const horizon = (monitor as unknown as { horizon: "3d"|"5d"|"10d" }).horizon;
  const key = horizon;
  const existing = await countResolvedHistorical(horizon);
  if (existing > 0 && !opts.force) return;

  const progress: BacklogProgress = {
    horizon,
    daysProcessed: 0,
    daysTotal: HISTORICAL_LOOKBACK_DAYS,
    samplesAdded: 0,
    running: true,
    error: null,
  };
  progressByHorizon.set(key, progress);

  try {
    const universeEntries = await fetchActiveUniverse(600);
    if (universeEntries.length === 0) throw new Error("empty universe");

    const symbols = universeEntries.map((u) => u.symbol);
    // Fat window: 260 trading days back from today + 20 forward for horizon lookup.
    const dailyMap = await fetchDailyBars(symbols, 260 + Math.ceil(HISTORICAL_LOOKBACK_DAYS));
    const spyMap = await fetchDailyBars(["SPY"], 260);
    const spy = spyMap.get("SPY") ?? null;

    if ((spy?.length ?? 0) < MIN_HISTORY_DAYS) {
      throw new Error(`insufficient bar coverage (spy=${spy?.length ?? 0})`);
    }

    const horizonMin = parseHorizon(horizon);
    const calib = calibrate(horizonMin);
    const challenger = monitor.getChallenger();

    // Iterate day indices from oldest to newest within the lookback window.
    const spyLen = spy!.length;
    const startIdx = Math.max(0, spyLen - HISTORICAL_LOOKBACK_DAYS - 15);
    const endIdx = Math.max(0, spyLen - 15); // Leave 15d for forward lookup.
    progress.daysTotal = Math.max(0, endIdx - startIdx);

    for (let dayIdx = startIdx; dayIdx < endIdx; dayIdx++) {
      const D = spy![dayIdx].t;
      const rows = buildRowsForDay(symbols, dailyMap, spy!, dayIdx, calib, horizonMin);
      const sessionForDay = "regular" as const;
      const cashFraction = 0.5;

      for (const row of rows) {
        const features = extractFeatures(row, { cashFraction, tickerEdge: 0 });
        const bucket = bucketKey(row.role, sessionForDay);
        const { estimate: chalEdge } = challenger.predict(bucket, features, row.modelEdge);
        const chalNet = row.net + (chalEdge - row.modelEdge);
        const chalDecision = deriveDecision(row, chalNet);

        const netDiverges = Math.abs(chalNet - row.net) > NET_DIVERGENCE_BPS;
        if (row.decision === chalDecision && !netDiverges) continue;

        // Forward price = close at dayIdx + horizonDays.
        const horizonTradingDays = Math.round(HORIZON_RESOLUTION_MS[monitor["horizon" as keyof typeof monitor] as "3d"|"5d"|"10d"] / (6.5 * 60 * 60 * 1000));
        const forwardIdx = dayIdx + horizonTradingDays;
        const symBars = dailyMap.get(row.symbol);
        if (!symBars || forwardIdx >= symBars.length) continue;
        const forwardPrice = symBars[forwardIdx].c;
        if (!forwardPrice || row.price <= 0) continue;

        const realizedBps = (forwardPrice / row.price - 1) * 10000;
        const baselineValueBps = valueOf(row.decision, realizedBps);
        const challengerValueBps = valueOf(chalDecision, realizedBps);
        const deltaBps = challengerValueBps - baselineValueBps;

        await insertResolved({
          id: newId(),
          horizon,
          symbol: row.symbol,
          submittedAt: D,
          resolvedAt: new Date().toISOString(),
          baselineDecision: row.decision,
          challengerDecision: chalDecision,
          realizedBps,
          baselineValueBps,
          challengerValueBps,
          deltaBps,
          source: "historical",
          clean: 1,
        });
        challenger.update(bucket, features, challengerValueBps);
        progress.samplesAdded += 1;
      }
      progress.daysProcessed += 1;

      if (progress.daysProcessed % 20 === 0) {
        await challenger.flushNow();
      }
    }
    await challenger.flushNow();
    progress.running = false;
  } catch (err) {
    progress.error = (err as Error).message;
    progress.running = false;
  }
}

// -- helpers ----------------------------------------------------------------

function buildRowsForDay(
  symbols: string[],
  dailyMap: Map<string, import("@/lib/data/bars").DailyBar[]>,
  spy: import("@/lib/data/bars").DailyBar[],
  dayIdx: number,
  calib: ReturnType<typeof calibrate>,
  horizonMin: number,
): ScanRow[] {
  const rawInputs: RawSymbolInputs[] = [];
  const packs: Array<{
    symbol: string;
    price: number;
    features: import("@/lib/data/bars").BarFeatures;
  }> = [];
  for (const sym of symbols) {
    const bars = dailyMap.get(sym);
    if (!bars || dayIdx >= bars.length) continue;
    const window = bars.slice(Math.max(0, dayIdx - 260), dayIdx + 1);
    if (window.length < 30) continue;
    const spyWindow = spy.slice(Math.max(0, dayIdx - 260), dayIdx + 1);
    const feats = computeBarFeatures(window, spyWindow, null);
    const price = window[window.length - 1].c;
    if (!price || price <= 0) continue;
    packs.push({ symbol: sym, price, features: feats });
    rawInputs.push({
      ret_3d: feats.ret_3d,
      ret_5d: feats.ret_5d,
      ret_10d: feats.ret_10d,
      retPrev5d: feats.ret_prev_5d,
      ret_21d: feats.ret_21d ?? 0,
      ret_63d: feats.ret_63d ?? 0,
      ret_126d: feats.ret_126d ?? 0,
      trend_slope: feats.trend_slope ?? 0,
      priceOverSma50: feats.sma50 && feats.sma50 > 0 ? price / feats.sma50 : 1,
      priceOverHigh60d: feats.high_60d && feats.high_60d > 0 ? price / feats.high_60d : 0.95,
      retPrev21d: feats.ret_prev_21d ?? 0,
      dayVol: price * 0,
      avg20dVol: feats.avg_dollar_vol_20d ?? 1_000_000,
      revGrowth: null,
      earnGrowth: null,
      profitMargin: null,
      roe: null,
      debtToEquity: null,
      fwdPE: null,
      spreadBps: 8,
      barDollarVol: 1_000_000,
      relVol: 1,
      realizedVol: feats.realized_vol_ann ?? 0.3,
      beta: feats.beta_vs_spy ?? 1,
      maxDD60d: feats.max_drawdown_60d ?? 0,
    });
  }
  if (packs.length === 0) return [];
  const families = computeFamilies(rawInputs);
  const stage1 = packs.map((p, i) => {
    const signals = families[i];
    const f = forecast({
      signals,
      confidence: 1,
      volAnn: p.features.realized_vol_ann ?? 0.3,
      edgeHorizonMin: horizonMin,
      calib,
    });
    return { pack: p, signals, pUp: f.pUp, mu: f.mu, composite: f.composite, evidence: f.evidence };
  });

  const pUpScale = (pUp: number) => Math.max(0, 2 * pUp - 1);
  const provisional = stage1.map((s) => calib.edgePrimary * calib.frictionPrimary * pUpScale(s.pUp));
  const assignments = assignRoles(
    stage1.map((s, i) => ({
      evidence: s.evidence,
      pUp: s.pUp,
      modelEdge: provisional[i],
      isHeld: false,
    })),
    calib,
  );

  const out: ScanRow[] = stage1.map((s, i) => {
    const role: Role = assignments[i].role;
    const baseRoleEdge =
      role === "primary" ? calib.edgePrimary :
      role === "secondary" ? calib.edgeSecondary :
      role === "retained" ? calib.edgeRetained : 0;
    const friction =
      role === "primary" ? calib.frictionPrimary :
      role === "secondary" ? calib.frictionSecondary :
      role === "retained" ? calib.frictionRetained : calib.frictionFloor;
    const roleEdge = baseRoleEdge * pUpScale(s.pUp);
    const isMember = s.evidence >= calib.evidenceThreshold && s.pUp >= calib.memberPupMin;
    const g = gateDecision({
      role,
      roleEdge,
      friction,
      frictionFloor: calib.frictionFloor,
      frictionCeiling: calib.frictionCeiling,
      spreadBps: 8,
      volPctPerBar: 0.012,
      notional: 10_000,
      barDollarVol: 1_000_000,
      quoteAgeSec: 0,
      gapDays: 1,
      sessionMult: calib.sessionRegular,
      exitReserve: calib.exitReserve,
      opRisk: calib.opRisk,
      cashWait: calib.cashWait,
      minHurdle: calib.minHurdle,
      isHeld: false,
      isMember,
    });
    return {
      symbol: s.pack.symbol,
      price: s.pack.price,
      decision: g.decision,
      role,
      net: g.net,
      modelEdge: g.modelEdge,
      confidence: 1,
      momentum: s.signals.momentum,
      quality: s.signals.quality,
      liquidity: s.signals.liquidity,
      risk: s.signals.risk,
      composite: s.composite,
      pUp: s.pUp,
      mu: s.mu,
      evidence: s.evidence,
      reason: g.decision,
      // Fields we don't use for backlog computation but must satisfy the type:
      volAnn: s.pack.features.realized_vol_ann ?? 0.3,
      spreadBps: 8,
      cEntry: g.cEntry,
      cExit: g.cExit,
      cQueue: g.cQueue,
      cMemory: g.cMemory,
      concentrationBps: 0,
      star: false,
      starScore: null,
      source: "alpaca",
      exchange: "NASDAQ",
      targetWeight: 0,
      horizonLadder: [],
      crossesWeekend: false,
      gapDays: 1,
      stopPx: 0,
      stopLimitPx: 0,
      fairValueTargetPx: 0,
      takeProfitLimitPx: 0,
      confidenceFactors: {
        source: 1,
        staleQuote: 1,
        missingFundamentals: 1,
        wideSpread: 1,
        missingFields: 1,
        familyDisagreement: 1,
      },
    } as unknown as ScanRow;
  });
  return out;
}

function deriveDecision(row: ScanRow, chalNet: number): string {
  if (row.role === "none") return "HOLD-CASH";
  if (chalNet > 0) return "BUY";
  return "WAIT";
}

function valueOf(decision: string, realizedBps: number): number {
  return decision === "BUY" ? realizedBps : -realizedBps;
}
```

**Implementer note:** the `buildRowsForDay` function re-implements the scanner's pipeline against daily bars only. If any field on `ScanRow` doesn't exist in your local `src/lib/engine/types.ts`, comment it out from the returned object — the `as unknown as ScanRow` cast makes this tolerant. Do NOT modify `types.ts`.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no TypeScript errors. Some lint warnings on the `as unknown as` cast are acceptable (documented in the note above).

- [ ] **Step 3: Commit**

```bash
git add src/lib/shadow/backlog.ts
git commit -m "feat(shadow): historical backlog runner (200-day daily-bar replay)"
```

---

## Task 7: Bootstrap + scanner hook + instrumentation

**Files:**
- Create: `src/lib/shadow/index.ts`
- Create: `src/instrumentation.ts`
- Modify: `src/lib/engine/scanner.ts` — add `shadowMonitorAsync(snap)` call after `persistSnapshotAsync(snap)` in `getLatestSnapshot`.

**Interfaces:**
- Consumes: `ShadowMonitor` from `./monitor`, `runHistoricalBacklog`, `getBacklogProgress` from `./backlog`.
- Produces:
  - `function bootstrapShadowMonitors(): void` — creates one monitor per horizon if `SHADOW_ENABLED=true`, initializes, schedules backlog.
  - `function shadowMonitorAsync(snap: ScanSnapshot): void` — fire-and-forget entry for scanner.
  - `function getMonitor(horizon: "3d"|"5d"|"10d"): ShadowMonitor | null`.
  - `export { getBacklogProgress, runHistoricalBacklog }`.
  - `src/instrumentation.ts` — Next.js 16 `register()` hook that calls `bootstrapShadowMonitors()`.

- [ ] **Step 1: Create `src/lib/shadow/index.ts`**

```ts
// Shadow monitor bootstrap + fire-and-forget entry point.

import type { ScanSnapshot } from "@/lib/engine/types";
import { ShadowMonitor } from "./monitor";
import { runHistoricalBacklog, getBacklogProgress } from "./backlog";

export { getBacklogProgress, runHistoricalBacklog };

const HORIZONS = ["3d", "5d", "10d"] as const;
type Horizon = typeof HORIZONS[number];

const monitors = new Map<Horizon, ShadowMonitor>();
let bootstrapped = false;

export function bootstrapShadowMonitors(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  if (process.env.SHADOW_ENABLED !== "true") {
    console.log("[shadow] SHADOW_ENABLED != 'true'; monitors disabled");
    return;
  }
  for (const h of HORIZONS) {
    const m = new ShadowMonitor(h);
    monitors.set(h, m);
    // Init + backlog kickoff, fire-and-forget.
    void (async () => {
      try {
        await m.init();
        await runHistoricalBacklog(m);
      } catch (err) {
        console.warn(`[shadow] bootstrap failed for ${h}:`, err);
      }
    })();
  }

  // Graceful shutdown: flush challenger state on SIGTERM / SIGINT.
  const flushAll = async () => {
    for (const m of monitors.values()) await m.flushShutdown();
  };
  process.on("SIGTERM", () => { void flushAll(); });
  process.on("SIGINT", () => { void flushAll(); });
}

export function shadowMonitorAsync(snap: ScanSnapshot): void {
  const h = snap.horizon as Horizon;
  const m = monitors.get(h);
  if (!m) return;
  void m.observe(snap);
}

export function getMonitor(horizon: Horizon): ShadowMonitor | null {
  return monitors.get(horizon) ?? null;
}
```

- [ ] **Step 2: Create `src/instrumentation.ts`**

```ts
// Next.js 16 server bootstrap. Runs once per server boot.
// See https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

import { bootstrapShadowMonitors } from "@/lib/shadow";

export async function register(): Promise<void> {
  bootstrapShadowMonitors();
}
```

- [ ] **Step 3: Hook into `scanner.ts`**

Open `src/lib/engine/scanner.ts`. Add near the top imports:

```ts
import { shadowMonitorAsync } from "@/lib/shadow";
```

Locate the `.then((snap) => {...})` block inside `getLatestSnapshot` (the same block currently containing `persistSnapshotAsync(snap)`). Add `shadowMonitorAsync(snap)` immediately after:

```ts
  entry.inflight = refresh(horizon).then((snap) => {
    entry.snapshot = snap;
    entry.ts = Date.now();
    entry.inflight = null;
    persistSnapshotAsync(snap);
    shadowMonitorAsync(snap);   // NEW
    return snap;
  }).catch((err) => {
    entry.inflight = null;
    throw err;
  });
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shadow/index.ts src/instrumentation.ts src/lib/engine/scanner.ts
git commit -m "feat(shadow): bootstrap + scanner hook + Next.js instrumentation"
```

---

## Task 8: Admin API routes

**Files:**
- Create: `src/app/api/admin/shadow/summary/route.ts`
- Create: `src/app/api/admin/shadow/[horizon]/route.ts`
- Create: `src/app/api/admin/shadow/backlog/route.ts`

**Interfaces:**
- Consumes: `auth()` from `@/auth`, shadow public API from `@/lib/shadow`, persistence queries.
- Produces:
  - `GET /api/admin/shadow/summary` → `ShadowSummary` payload.
  - `GET /api/admin/shadow/[horizon]` → `ShadowDetail` payload.
  - `POST /api/admin/shadow/backlog` with body `{ horizon: "3d"|"5d"|"10d"; force?: boolean }` → `{ scheduled: true }`.

- [ ] **Step 1: Create the summary route**

Create `src/app/api/admin/shadow/summary/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getBacklogProgress, getMonitor } from "@/lib/shadow";
import {
  countResolvedHistorical,
  queryResolvedForPosterior,
} from "@/lib/shadow/persistence";
import { computePosterior, type Posterior } from "@/lib/shadow/posterior";

export const dynamic = "force-dynamic";

export interface ShadowSummary {
  generatedAt: string;
  perHorizon: Array<{
    horizon: "3d" | "5d" | "10d";
    posterior_live: Posterior;
    posterior_all: Posterior;
    backlogStatus: "not-started" | "running" | "done";
    backlogSamples: number;
    pendingCount: number;
  }>;
}

const CACHE_TTL_MS = 10_000;
let cache: { payload: ShadowSummary; ts: number } | null = null;

const HORIZONS = ["3d", "5d", "10d"] as const;

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Auth checked above — safe to serve cached payload without re-verifying.
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }

  const perHorizon = await Promise.all(
    HORIZONS.map(async (h) => {
      const [liveRows, allRows, backlogSamples, prog] = await Promise.all([
        queryResolvedForPosterior(h, "live"),
        queryResolvedForPosterior(h, "all"),
        countResolvedHistorical(h),
        Promise.resolve(getBacklogProgress(h)),
      ]);
      const status: "not-started" | "running" | "done" = prog.running
        ? "running"
        : backlogSamples > 0
          ? "done"
          : "not-started";
      return {
        horizon: h,
        posterior_live: computePosterior(liveRows),
        posterior_all: computePosterior(allRows),
        backlogStatus: status,
        backlogSamples,
        pendingCount: getMonitor(h) ? 0 : 0, // placeholder; real pending count computed in detail route
      };
    }),
  );

  const payload: ShadowSummary = {
    generatedAt: new Date().toISOString(),
    perHorizon,
  };
  cache = { payload, ts: Date.now() };
  return NextResponse.json(payload);
}
```

- [ ] **Step 2: Create the detail route**

Create `src/app/api/admin/shadow/[horizon]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMonitor } from "@/lib/shadow";
import {
  queryResolvedForPosterior,
  queryRecentPending,
  queryRecentResolvedLive,
  queryHistoricalDailyDelta,
} from "@/lib/shadow/persistence";
import { computePosterior, type Posterior } from "@/lib/shadow/posterior";

export const dynamic = "force-dynamic";

const HORIZONS = new Set(["3d", "5d", "10d"]);

export interface ShadowDetail {
  horizon: "3d" | "5d" | "10d";
  posterior_live: Posterior;
  posterior_all: Posterior;
  buckets: Array<{ bucket: string; n: number; mean_y_bps: number }>;
  pending: Array<{
    symbol: string; baselineDecision: string; challengerDecision: string;
    baselineNetBps: number; challengerNetBps: number; submittedAt: string;
  }>;
  resolved: Array<{
    symbol: string; delta_bps: number; realized_bps: number;
    baseline_decision: string; challenger_decision: string; resolvedAt: string;
  }>;
  historicalDailyDelta: Array<{ day: string; mean_delta_bps: number; n: number }>;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ horizon: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { horizon } = await params;
  if (!HORIZONS.has(horizon)) {
    return NextResponse.json({ error: "bad horizon" }, { status: 400 });
  }
  const h = horizon as "3d" | "5d" | "10d";
  const [liveRows, allRows, pending, resolved, hist] = await Promise.all([
    queryResolvedForPosterior(h, "live"),
    queryResolvedForPosterior(h, "all"),
    queryRecentPending(h, 20),
    queryRecentResolvedLive(h, 20),
    queryHistoricalDailyDelta(h),
  ]);
  const monitor = getMonitor(h);
  const buckets = monitor ? monitor.getChallenger().status() : [];

  const detail: ShadowDetail = {
    horizon: h,
    posterior_live: computePosterior(liveRows),
    posterior_all: computePosterior(allRows),
    buckets,
    pending: pending.map((p) => ({
      symbol: p.symbol,
      baselineDecision: p.baselineDecision,
      challengerDecision: p.challengerDecision,
      baselineNetBps: p.baselineNetBps,
      challengerNetBps: p.challengerNetBps,
      submittedAt: p.submittedAt,
    })),
    resolved: resolved.map((r) => ({
      symbol: r.symbol,
      delta_bps: r.deltaBps,
      realized_bps: r.realizedBps,
      baseline_decision: r.baselineDecision,
      challenger_decision: r.challengerDecision,
      resolvedAt: r.resolvedAt,
    })),
    historicalDailyDelta: hist,
  };
  return NextResponse.json(detail);
}
```

- [ ] **Step 3: Create the backlog trigger route**

Create `src/app/api/admin/shadow/backlog/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMonitor, runHistoricalBacklog } from "@/lib/shadow";

const HORIZONS = new Set(["3d", "5d", "10d"]);

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as
    | { horizon?: string; force?: boolean }
    | null;
  if (!body || !body.horizon || !HORIZONS.has(body.horizon)) {
    return NextResponse.json({ error: "bad horizon" }, { status: 400 });
  }
  const m = getMonitor(body.horizon as "3d"|"5d"|"10d");
  if (!m) return NextResponse.json({ error: "monitor disabled" }, { status: 503 });
  // Fire-and-forget; caller polls /summary for progress.
  void runHistoricalBacklog(m, { force: !!body.force });
  return NextResponse.json({ scheduled: true });
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/shadow/
git commit -m "feat(shadow): admin API routes (summary + detail + backlog trigger)"
```

---

## Task 9: Basic ShadowSection for admin dashboard

**Files:**
- Create: `src/app/admin/sections/ShadowSection.tsx`
- Modify: `src/app/admin/AdminDashboard.tsx` — mount `<ShadowSection />` between existing sections.

**Interfaces:**
- Consumes: `ShadowSummary` from `@/app/api/admin/shadow/summary/route` (type-only).
- Produces: `<ShadowSection />` component polling `/api/admin/shadow/summary` every 12s.

- [ ] **Step 1: Create the ShadowSection component**

Create `src/app/admin/sections/ShadowSection.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ShadowSummary } from "@/app/api/admin/shadow/summary/route";

const POLL_MS = 12_000;

export function ShadowSection() {
  const [data, setData] = useState<ShadowSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchOnce = async () => {
      try {
        const r = await fetch("/api/admin/shadow/summary", { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const json = (await r.json()) as ShadowSummary;
        if (!alive) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "unknown");
      }
    };
    fetchOnce();
    const t = setInterval(fetchOnce, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>▸ Shadow monitor · challenger vs baseline</CardTitle>
        <Link
          href="/admin/shadow"
          className="font-mono text-[10px] uppercase tracking-wider text-primary hover:underline"
        >
          open →
        </Link>
      </CardHeader>
      <CardContent>
        {error && <div className="font-mono text-[11px] text-error">error · {error}</div>}
        {!data ? (
          <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>
        ) : (
          <>
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="text-on-surface-variant">
                  <th className="text-left">horizon</th>
                  <th className="text-right">δ_post (live)</th>
                  <th className="text-right">n (live)</th>
                  <th className="text-right">pos%</th>
                  <th className="text-left pl-3">status</th>
                </tr>
              </thead>
              <tbody>
                {data.perHorizon.map((h) => (
                  <tr key={h.horizon} className="border-t border-border/50">
                    <td className="py-1 font-semibold text-on-surface">{h.horizon}</td>
                    <td className={cn(
                      "py-1 text-right tabular-nums",
                      h.posterior_live.delta_post_bps > 0 ? "text-success" : "text-error",
                    )}>
                      {h.posterior_live.delta_post_bps > 0 ? "+" : ""}
                      {h.posterior_live.delta_post_bps.toFixed(1)} bps
                    </td>
                    <td className="py-1 text-right tabular-nums text-on-surface">
                      {h.posterior_live.n_clean}
                    </td>
                    <td className="py-1 text-right tabular-nums text-on-surface-variant">
                      {Math.round(h.posterior_live.positive_share * 100)}%
                    </td>
                    <td className="py-1 pl-3">
                      <StatusPill posterior={h.posterior_live} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 font-mono text-[10px] text-on-surface-variant">
              historical:{" "}
              {data.perHorizon.reduce((a, h) => a + h.backlogSamples, 0)} samples ·{" "}
              biased posteriors excluded from promotion criterion
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({ posterior }: { posterior: { promotable: boolean; n_clean: number } }) {
  const label = posterior.promotable
    ? "promotable"
    : posterior.n_clean < 30
      ? `n<30`
      : "hold";
  const tone = posterior.promotable ? "text-success" : "text-on-surface-variant";
  return (
    <span className={cn("font-mono text-[10px] uppercase tracking-wider", tone)}>
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Wire into AdminDashboard**

Open `src/app/admin/AdminDashboard.tsx`. Add near the other section imports:

```tsx
import { ShadowSection } from "./sections/ShadowSection";
```

Insert `<ShadowSection />` between `<SignalQualitySection />` and `<PipelineHealthSection />`:

```tsx
        <SignalQualitySection signal={data?.signal ?? null} onSymbolClick={setFocusedSymbol} />
        <ShadowSection />
        <PipelineHealthSection pipeline={data?.pipeline ?? null} />
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/sections/ShadowSection.tsx src/app/admin/AdminDashboard.tsx
git commit -m "feat(shadow): basic ShadowSection on /admin dashboard"
```

---

## Task 10: Detail page `/admin/shadow`

**Files:**
- Create: `src/app/admin/shadow/page.tsx`
- Create: `src/app/admin/shadow/ShadowClient.tsx`

**Interfaces:**
- Consumes: `ShadowDetail` from the detail route (type-only), auth for defense-in-depth.
- Produces: full detail page under `/admin/shadow` with per-horizon tabs.

- [ ] **Step 1: Create the server page**

Create `src/app/admin/shadow/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ShadowClient } from "./ShadowClient";

export const dynamic = "force-dynamic";

export default async function AdminShadowPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/upgrade?reason=admin-only");
  }
  return <ShadowClient />;
}
```

- [ ] **Step 2: Create the client component**

Create `src/app/admin/shadow/ShadowClient.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ShadowDetail } from "@/app/api/admin/shadow/[horizon]/route";

const HORIZONS = ["3d", "5d", "10d"] as const;
type Horizon = typeof HORIZONS[number];

export function ShadowClient() {
  const [horizon, setHorizon] = useState<Horizon>("3d");
  const [data, setData] = useState<ShadowDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backlogBusy, setBacklogBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    (async () => {
      try {
        const r = await fetch(`/api/admin/shadow/${horizon}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const json = (await r.json()) as ShadowDetail;
        if (!alive) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "unknown");
      }
    })();
    return () => { alive = false; };
  }, [horizon]);

  const triggerBacklog = async (force: boolean) => {
    setBacklogBusy(true);
    try {
      await fetch("/api/admin/shadow/backlog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ horizon, force }),
      });
    } finally {
      setBacklogBusy(false);
    }
  };

  return (
    <main className="relative flex flex-1 flex-col px-6 py-8">
      <div className="mx-auto w-full max-w-[1280px] space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-low px-5 py-3">
          <div className="flex items-baseline gap-3">
            <Link href="/admin" className="font-mono text-[11px] text-on-surface-variant hover:text-on-surface">
              ← admin
            </Link>
            <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-on-surface">
              ◆ Shadow monitor
            </h1>
          </div>
          <div className="inline-flex items-center rounded-md border border-border bg-surface-lowest p-0.5">
            {HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={cn(
                  "rounded px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors",
                  h === horizon
                    ? "bg-surface-high text-on-surface"
                    : "text-on-surface-variant hover:bg-surface-low hover:text-on-surface",
                )}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <Card>
            <CardContent>
              <div className="font-mono text-[11px] text-error">error · {error}</div>
            </CardContent>
          </Card>
        )}

        {!data && !error && (
          <Card>
            <CardContent>
              <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>
            </CardContent>
          </Card>
        )}

        {data && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>▸ Posterior (live)</CardTitle></CardHeader>
              <CardContent>
                <PosteriorTable p={data.posterior_live} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>▸ Posterior (live + historical, biased)</CardTitle>
              </CardHeader>
              <CardContent>
                <PosteriorTable p={data.posterior_all} />
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader><CardTitle>▸ Buckets</CardTitle></CardHeader>
              <CardContent>
                {data.buckets.length === 0 ? (
                  <div className="font-mono text-[11px] text-on-surface-variant">no buckets yet</div>
                ) : (
                  <table className="w-full font-mono text-[11px]">
                    <thead>
                      <tr className="text-on-surface-variant">
                        <th className="text-left">bucket</th>
                        <th className="text-right">n</th>
                        <th className="text-right">mean_y</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.buckets.map((b) => (
                        <tr key={b.bucket} className="border-t border-border/50">
                          <td className="py-1 text-on-surface">{b.bucket}</td>
                          <td className="py-1 text-right tabular-nums">{b.n}</td>
                          <td className="py-1 text-right tabular-nums text-on-surface-variant">
                            {b.mean_y_bps.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>▸ Recent pending</CardTitle></CardHeader>
              <CardContent>
                {data.pending.length === 0 ? (
                  <div className="font-mono text-[11px] text-on-surface-variant">quiet</div>
                ) : (
                  <table className="w-full font-mono text-[11px]">
                    <thead>
                      <tr className="text-on-surface-variant">
                        <th className="text-left">sym</th>
                        <th className="text-left">base → chal</th>
                        <th className="text-right">Δnet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.pending.map((p, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="py-1 text-on-surface font-semibold">{p.symbol}</td>
                          <td className="py-1 text-on-surface-variant">
                            {p.baselineDecision} → {p.challengerDecision}
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {(p.challengerNetBps - p.baselineNetBps).toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>▸ Recent resolved (live)</CardTitle></CardHeader>
              <CardContent>
                {data.resolved.length === 0 ? (
                  <div className="font-mono text-[11px] text-on-surface-variant">none yet</div>
                ) : (
                  <table className="w-full font-mono text-[11px]">
                    <thead>
                      <tr className="text-on-surface-variant">
                        <th className="text-left">sym</th>
                        <th className="text-right">δ</th>
                        <th className="text-right">realized</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.resolved.map((r, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="py-1 text-on-surface font-semibold">{r.symbol}</td>
                          <td className={cn(
                            "py-1 text-right tabular-nums",
                            r.delta_bps > 0 ? "text-success" : "text-error",
                          )}>{r.delta_bps > 0 ? "+" : ""}{r.delta_bps.toFixed(1)}</td>
                          <td className="py-1 text-right tabular-nums text-on-surface-variant">
                            {r.realized_bps.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>▸ Backlog</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={backlogBusy}
                    onClick={() => triggerBacklog(false)}
                    className="rounded border border-border bg-surface-lowest px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant hover:text-on-surface disabled:opacity-50"
                  >
                    Run backlog (idempotent)
                  </button>
                  <button
                    type="button"
                    disabled={backlogBusy}
                    onClick={() => triggerBacklog(true)}
                    className="rounded border border-error bg-surface-lowest px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-error hover:brightness-110 disabled:opacity-50"
                  >
                    Force re-seed
                  </button>
                </div>
                <div className="mt-3 font-mono text-[10px] text-on-surface-variant">
                  historical daily δ: {data.historicalDailyDelta.length} days recorded
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}

function PosteriorTable({ p }: { p: ShadowDetail["posterior_live"] }) {
  return (
    <dl className="grid grid-cols-2 gap-y-1 font-mono text-[11px]">
      <dt className="text-on-surface-variant">n_clean</dt>
      <dd className="text-right tabular-nums">{p.n_clean}</dd>
      <dt className="text-on-surface-variant">mean δ</dt>
      <dd className="text-right tabular-nums">{p.mean_delta_bps.toFixed(1)} bps</dd>
      <dt className="text-on-surface-variant">positive share</dt>
      <dd className="text-right tabular-nums">{Math.round(p.positive_share * 100)}%</dd>
      <dt className="text-on-surface-variant">δ_post</dt>
      <dd className={cn(
        "text-right tabular-nums",
        p.delta_post_bps > 0 ? "text-success" : "text-error",
      )}>
        {p.delta_post_bps > 0 ? "+" : ""}{p.delta_post_bps.toFixed(2)} bps
      </dd>
      <dt className="text-on-surface-variant">promotable</dt>
      <dd className="text-right">{p.promotable ? "yes" : "no"}</dd>
      <dt className="col-span-2 mt-1 text-on-surface-variant">{p.reason}</dt>
    </dl>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/shadow/
git commit -m "feat(shadow): /admin/shadow detail page with per-horizon tabs"
```

---

## Task 11: End-to-end verification

**Files:** none modified — validation only.

**Interfaces:** none.

- [ ] **Step 1: Rebuild and boot**

Run:

```bash
docker compose up -d --build app
```

Wait ~30s.

- [ ] **Step 2: Apply CH schema addition**

The `03_shadow_schema.sql` file only auto-runs on fresh CH volumes. Apply manually:

```bash
cat services/clickhouse/init/03_shadow_schema.sql | \
  docker exec -i singscanner-ch clickhouse-client -d singscanner --multiquery
```

Verify:

```bash
docker exec singscanner-ch clickhouse-client -d singscanner --query "SHOW TABLES LIKE 'shadow_%'"
```

Expected output:
```
shadow_buckets
shadow_pending
shadow_resolved
```

- [ ] **Step 3: Confirm SHADOW_ENABLED is set**

Ensure `.env` (or docker-compose environment) has `SHADOW_ENABLED=true`. If not, add it and restart:

```bash
docker compose restart app
```

Check the app logs — you should see the bootstrap message:

```bash
docker logs singscanner-app | grep '\[shadow\]'
```

Expected: no `SHADOW_ENABLED != 'true'; monitors disabled` message. If backlog is running, no bootstrap-failed messages.

- [ ] **Step 4: Verify backlog ran**

Wait 60s after boot for backlog to make progress, then:

```bash
docker exec singscanner-ch clickhouse-client -d singscanner --query "
  SELECT horizon, source, count() AS n
  FROM shadow_resolved
  GROUP BY horizon, source
  ORDER BY horizon, source"
```

Expected: `source='historical'` rows for each of 3d/5d/10d in the hundreds or thousands.

- [ ] **Step 5: Verify buckets populated**

```bash
docker exec singscanner-ch clickhouse-client -d singscanner --query "
  SELECT horizon, bucket, n, round(mean_y, 2) AS mean_y_bps
  FROM shadow_buckets FINAL
  ORDER BY horizon, bucket"
```

Expected: multiple `(horizon, bucket)` combinations with `n > 0`.

- [ ] **Step 6: Visit `/admin` and confirm the Shadow section renders**

Browser: `http://<server>:3097/admin` (or your port). Expected:
- New Shadow section between Signal Quality and Pipeline Health.
- Table lists 3d/5d/10d rows.
- Each row shows δ_post (live) — likely 0 or near-0 since no live samples yet.
- Historical sample count > 0.

- [ ] **Step 7: Visit `/admin/shadow`**

Click the "open →" link. Expected:
- Horizon selector at top; clicking 3d/5d/10d switches data.
- Posterior cards populate.
- Bucket table shows at least a few `(role|session)` combinations.
- "Historical daily δ" count > 0.

- [ ] **Step 8: Verify live divergences will accumulate**

Trigger a scan by visiting `/dashboard`. Wait for two consecutive scans (~30s). Then:

```bash
docker exec singscanner-ch clickhouse-client -d singscanner --query "
  SELECT count() FROM shadow_pending WHERE source='live'"
```

Expected: > 0 (unless the challenger and baseline happen to agree on every symbol; unlikely with 600 symbols).

- [ ] **Step 9: Verify non-admin blocked**

Log out. Log back in as a non-ADMIN user. Navigate to `/admin/shadow` — expect redirect to `/upgrade?reason=admin-only`.

Curl the API with a non-admin cookie:

```bash
curl -i http://<server>:3097/api/admin/shadow/summary -H "cookie: <non-admin-session>"
```

Expected: `HTTP/1.1 403` with `{"error":"forbidden"}`.

- [ ] **Step 10: No commit for this task**

Validation only.

---

## Self-review

**Spec coverage:**
- ✅ Three CH tables (Task 1) — `shadow_pending`, `shadow_resolved`, `shadow_buckets`.
- ✅ Feature vector + session bucketing (Task 2).
- ✅ Beta-shrinkage posterior with `κ₀=7, δ₀=0` (Task 3).
- ✅ DynamicActionValueChallenger port (Task 4) — predict + update + ridge + decay + persistence.
- ✅ ShadowMonitor per horizon (Task 5) — observe + resolvePending + dedup.
- ✅ Historical backlog (Task 6) — idempotent, seeded from 200 days of daily bars.
- ✅ Bootstrap + scanner hook + `src/instrumentation.ts` (Task 7).
- ✅ Three admin API routes with `auth()` gate (Task 8).
- ✅ Basic dashboard section (Task 9).
- ✅ Detail page with per-horizon tabs (Task 10).
- ✅ End-to-end verification (Task 11) covers: schema, backlog, dashboards, live divergences, non-admin block.
- ✅ Non-goals respected: no auto-promotion, no held-side divergence in v1, no multi-challenger.

**Placeholder scan:** No TBDs. The "Implementer note" in Task 6 about `as unknown as ScanRow` cast is explicit — not vague guidance. The `pendingCount: getMonitor(h) ? 0 : 0` in Task 8 Step 1 is a deliberate placeholder for a metric that isn't in the summary contract; kept as `0` because the detail route already surfaces recent pending counts.

**Type consistency:** `Posterior`, `ShadowSummary`, `ShadowDetail`, `PendingRow`, `ResolvedRow`, `BucketRow`, `PredictDiag`, `FeatureContext`, `SessionBucket`, `BacklogProgress` are each defined once and imported (via type-only imports) at consumers. Method signatures on `DynamicActionValueChallenger` (`predict`, `update`, `flushNow`, `status`, `load`) match Task 5's usage. `HORIZON_RESOLUTION_MS` exported from `monitor.ts` and reused in `backlog.ts`. All API route handlers use `params: Promise<...>` for Next 16 async params.
