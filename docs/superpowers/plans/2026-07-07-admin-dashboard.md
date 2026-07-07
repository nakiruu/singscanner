# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub `/admin` page with a working D2-layout (three stacked sections + toggleable activity drawer) admin console showing signal quality (from CH), pipeline health, business metrics (from postgres + stubs), an activity feed, and drill-throughs into symbols/events/users.

**Architecture:** Client-side polling (12s) hitting two new ADMIN-gated API routes (`/api/admin/summary` + `/api/admin/activity`) which read from ClickHouse, postgres, and a new in-memory instrumentation module. Terminal/mono visual language matches the existing `/dashboard`. Drawers are overlays that don't resize page content.

**Tech Stack:** Next.js 16 (existing), TypeScript, `@clickhouse/client` (existing), Prisma (existing), NextAuth 5 (existing), Tailwind (existing), no new deps.

## Global Constraints

- **No test framework configured.** Validation uses `npm run build` (typecheck + compile) and `npm run lint`. Do NOT add vitest/jest.
- **Visual language matches the existing `/dashboard`.** Monospace, LED status dots, subtle borders, small-caps labels. Follow patterns in `src/components/dashboard/views/ActionableDashboard.tsx` for styling references (`bg-surface-low`, `border-border`, `font-mono`, `text-on-surface-variant`, etc).
- **API routes under `/api/admin/*` MUST perform an explicit session check** using `auth()` and return `403` if `session.user.role !== "ADMIN"`. The Next middleware's `matcher` excludes `api` (see `src/middleware.ts:57`), so admin API routes are NOT protected by middleware.
- **Fail-open for CH/metrics dependencies.** Any CH query failing → return sensible empty values in the summary payload, never throw at the client.
- **No new npm dependencies.** Everything is composable from existing packages.
- **Reference spec:** `docs/superpowers/specs/2026-07-07-admin-dashboard-design.md`.

---

## File structure

**Create:**
- `src/lib/data/metrics.ts` — in-memory ring buffers for Alpaca outcomes, scan durations, errors. Pure module, no side effects.
- `src/app/api/admin/summary/route.ts` — GET; server-side 10s cache; returns signal/pipeline/business data.
- `src/app/api/admin/activity/route.ts` — GET; returns feed events, param `?limit=50`.
- `src/app/api/admin/users/[id]/route.ts` — GET user detail (id, email, portfolio, watchlist).
- `src/app/api/admin/users/[id]/role/route.ts` — POST role override.
- `src/app/api/admin/users/[id]/suspend/route.ts` — POST suspend toggle.
- `src/app/admin/AdminDashboard.tsx` — main client component orchestrating the three sections + drawer state.
- `src/app/admin/sections/SignalQualitySection.tsx`
- `src/app/admin/sections/PipelineHealthSection.tsx`
- `src/app/admin/sections/BusinessSection.tsx`
- `src/app/admin/ActivityDrawer.tsx` — overlay drawer w/ inline event expand.
- `src/app/admin/SymbolDrillDrawer.tsx` — overlay drawer for symbol scan-history.
- `src/app/admin/hooks/useSummaryPolling.ts`
- `src/app/admin/hooks/useActivityPolling.ts`
- `src/app/admin/hooks/useAge.ts`
- `src/app/admin/users/[id]/page.tsx` — new user detail page.
- `src/app/admin/users/[id]/UserDetailClient.tsx` — client component for the user detail actions.
- `prisma/migrations/<generated>/migration.sql` — adds `suspended Boolean @default(false)` on User.

**Modify:**
- `src/app/admin/page.tsx` — replace stub with a thin server component that renders `<AdminDashboard />`.
- `src/lib/data/bars.ts` — call `recordAlpacaFetch(ok)` at end of `pullBars`.
- `src/lib/engine/scanner.ts` — time `buildLiveSnapshot`, call `recordScanDuration(ms)`.
- `src/lib/data/clickhouse.ts` — call `recordError({ kind: "ch", ... })` in each catch (keep existing `console.warn`).
- `src/lib/ml/fundamentals-client.ts` — same treatment for fundamentals fetch errors.
- `prisma/schema.prisma` — add `suspended Boolean @default(false)` on `User`.

---

## Task 1: `metrics.ts` — in-memory instrumentation module

**Files:**
- Create: `src/lib/data/metrics.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `recordAlpacaFetch(ok: boolean): void`
  - `getAlpacaSuccessRate(windowMs?: number): number` — ratio in `[0, 1]`, or `1` when no data.
  - `recordScanDuration(ms: number): void`
  - `getScanLatencyP95(): number` — ms, or `0` when no data.
  - `type MetricsErrorKind = "alpaca" | "ch" | "fundamentals"`
  - `interface MetricsError { id: string; kind: MetricsErrorKind; message: string; stack?: string; ts: number }`
  - `recordError(e: { kind: MetricsErrorKind; message: string; stack?: string }): void`
  - `getErrors(limit?: number): MetricsError[]` — newest first.
  - `getErrorDetail(id: string): MetricsError | null`

Ring buffer sizes are constants in the module: 500 Alpaca outcomes, 200 scan durations, 200 errors.

- [ ] **Step 1: Create the module with types and buffers**

Create `src/lib/data/metrics.ts` with this content:

```ts
// In-memory instrumentation for the admin dashboard. Small ring buffers,
// no side effects outside this module. Callers wire recording; the admin
// summary API reads. See docs/superpowers/specs/2026-07-07-admin-dashboard-design.md.

import { randomUUID } from "crypto";

// -- Alpaca fetch outcomes ---------------------------------------------------

const ALPACA_BUF_SIZE = 500;
interface AlpacaSample { ok: boolean; ts: number }
const alpacaBuf: AlpacaSample[] = [];

export function recordAlpacaFetch(ok: boolean): void {
  alpacaBuf.push({ ok, ts: Date.now() });
  if (alpacaBuf.length > ALPACA_BUF_SIZE) alpacaBuf.shift();
}

// Rolling success rate over the last `windowMs`. Returns 1.0 when there is
// no data so the dashboard doesn't show a bogus 0% before any calls happen.
export function getAlpacaSuccessRate(windowMs = 3_600_000): number {
  if (alpacaBuf.length === 0) return 1;
  const cutoff = Date.now() - windowMs;
  const recent = alpacaBuf.filter((s) => s.ts >= cutoff);
  if (recent.length === 0) return 1;
  const ok = recent.filter((s) => s.ok).length;
  return ok / recent.length;
}

// -- Scan durations ----------------------------------------------------------

const SCAN_BUF_SIZE = 200;
const scanDurations: number[] = [];

export function recordScanDuration(ms: number): void {
  scanDurations.push(ms);
  if (scanDurations.length > SCAN_BUF_SIZE) scanDurations.shift();
}

// p95 over the current buffer; 0 when empty.
export function getScanLatencyP95(): number {
  if (scanDurations.length === 0) return 0;
  const sorted = [...scanDurations].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// -- Errors ------------------------------------------------------------------

const ERR_BUF_SIZE = 200;
export type MetricsErrorKind = "alpaca" | "ch" | "fundamentals";
export interface MetricsError {
  id: string;
  kind: MetricsErrorKind;
  message: string;
  stack?: string;
  ts: number;
}
const errBuf: MetricsError[] = [];
const errIndex = new Map<string, MetricsError>();

export function recordError(e: {
  kind: MetricsErrorKind;
  message: string;
  stack?: string;
}): void {
  const rec: MetricsError = {
    id: randomUUID(),
    kind: e.kind,
    message: e.message,
    stack: e.stack,
    ts: Date.now(),
  };
  errBuf.push(rec);
  errIndex.set(rec.id, rec);
  if (errBuf.length > ERR_BUF_SIZE) {
    const dropped = errBuf.shift();
    if (dropped) errIndex.delete(dropped.id);
  }
}

export function getErrors(limit = 50): MetricsError[] {
  return errBuf.slice(-limit).reverse();
}

export function getErrorDetail(id: string): MetricsError | null {
  return errIndex.get(id) ?? null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build completes without TypeScript errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new lint errors in `src/lib/data/metrics.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/data/metrics.ts
git commit -m "feat(metrics): in-memory ring buffers for admin dashboard instrumentation"
```

---

## Task 2: Wire instrumentation into hot paths

**Files:**
- Modify: `src/lib/data/bars.ts` — record Alpaca outcome after `pullBars`.
- Modify: `src/lib/engine/scanner.ts` — time `buildLiveSnapshot`.
- Modify: `src/lib/data/clickhouse.ts` — call `recordError` in each catch.
- Modify: `src/lib/ml/fundamentals-client.ts` — same treatment for fundamentals errors.

**Interfaces:**
- Consumes: everything exported from `src/lib/data/metrics.ts`.
- Produces: nothing new. Side effect only.

- [ ] **Step 1: Instrument `pullBars` in bars.ts**

At the top of `src/lib/data/bars.ts`, add the import:

```ts
import { recordAlpacaFetch, recordError } from "./metrics";
```

Locate the `pullBars` function. Wrap the fetch loop so both success and failure are recorded once per invocation (not once per page). Change:

```ts
async function pullBars(
  group: string[],
  timeframe: string,
  start: Date,
  end: Date,
  sink: Map<string, DailyBar[]> | Map<string, IntradayBar[]>,
): Promise<void> {
  let pageToken: string | null = null;
  for (;;) {
    // ... existing body
    if (!pageToken) break;
  }
}
```

to:

```ts
async function pullBars(
  group: string[],
  timeframe: string,
  start: Date,
  end: Date,
  sink: Map<string, DailyBar[]> | Map<string, IntradayBar[]>,
): Promise<void> {
  let pageToken: string | null = null;
  try {
    for (;;) {
      // ... existing body unchanged
      if (!pageToken) break;
    }
    recordAlpacaFetch(true);
  } catch (err) {
    recordAlpacaFetch(false);
    if (err instanceof Error) {
      recordError({ kind: "alpaca", message: err.message, stack: err.stack });
    } else {
      recordError({ kind: "alpaca", message: String(err) });
    }
    throw err;
  }
}
```

(Preserve the existing body of the inner `for` loop verbatim.)

- [ ] **Step 2: Instrument `buildLiveSnapshot` in scanner.ts**

At the top of `src/lib/engine/scanner.ts`, add:

```ts
import { recordScanDuration } from "@/lib/data/metrics";
```

Wrap the body of `buildLiveSnapshot`. Change the outer shape:

```ts
async function buildLiveSnapshot(horizonSpec: string): Promise<ScanSnapshot> {
  // ... existing body
}
```

to:

```ts
async function buildLiveSnapshot(horizonSpec: string): Promise<ScanSnapshot> {
  const start = Date.now();
  try {
    // ... existing body verbatim, ending in `return {...}`
  } finally {
    recordScanDuration(Date.now() - start);
  }
}
```

The `try { ... } finally` wraps the entire existing body. The return statement stays inside `try`.

- [ ] **Step 3: Instrument CH errors in clickhouse.ts**

At the top of `src/lib/data/clickhouse.ts`, add:

```ts
import { recordError } from "./metrics";
```

Then in EACH `catch` block inside the exported functions (`insertBars`, `queryBars`, `queryBarsMulti`, `insertSnapshot`, `insertScanRows`), add a `recordError` call BEFORE the existing `console.warn`. Example transformation for one block:

```ts
  } catch (err) {
    console.warn(`[clickhouse] insertBars(${symbol}, ${timeframe}) failed:`, err);
  }
```

becomes:

```ts
  } catch (err) {
    if (err instanceof Error) {
      recordError({ kind: "ch", message: `insertBars(${symbol}, ${timeframe}): ${err.message}`, stack: err.stack });
    }
    console.warn(`[clickhouse] insertBars(${symbol}, ${timeframe}) failed:`, err);
  }
```

Apply the same pattern to every catch in the file — replace the `insertBars(...)` string with a descriptive per-function label (e.g. `queryBarsMulti(${symbols.length} symbols, ${timeframe})`).

- [ ] **Step 4: Instrument fundamentals errors**

Open `src/lib/ml/fundamentals-client.ts`. Add at the top:

```ts
import { recordError } from "@/lib/data/metrics";
```

For each catch block that handles a fetch failure, add a `recordError({ kind: "fundamentals", ... })` call before the existing warn / fallback. If the file has multiple catches, treat each the same way — do not rewrite the fallback logic.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no new TypeScript or lint errors in the four modified files.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data/bars.ts src/lib/engine/scanner.ts src/lib/data/clickhouse.ts src/lib/ml/fundamentals-client.ts
git commit -m "feat(metrics): wire Alpaca/scan/CH/fundamentals into instrumentation buffers"
```

---

## Task 3: Add `suspended` field on User + prisma migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<generated>/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `User.suspended: Boolean` (default `false`), available on prisma client.

- [ ] **Step 1: Edit schema.prisma**

Open `prisma/schema.prisma`. Find the `User` model. Add a new field after `updatedAt`:

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  username     String   @unique
  name         String?
  passwordHash String?
  image        String?
  role         Role     @default(USER)
  suspended    Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  accounts  Account[]
  sessions  Session[]
  portfolio PortfolioEntry[]
  watchlist WatchlistEntry[]
  settings  UserSettings?
}
```

- [ ] **Step 2: Generate migration**

Run:

```bash
npx prisma migrate dev --name add_user_suspended
```

Expected: creates `prisma/migrations/<timestamp>_add_user_suspended/migration.sql` containing an `ALTER TABLE "User" ADD COLUMN "suspended" BOOLEAN NOT NULL DEFAULT false;`. Prisma client regenerates automatically.

If postgres isn't reachable in the current environment, use `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` fallback is NOT sufficient — instead, hand-write the migration file at `prisma/migrations/<YYYYMMDDHHMMSS>_add_user_suspended/migration.sql` with:

```sql
ALTER TABLE "User" ADD COLUMN "suspended" BOOLEAN NOT NULL DEFAULT false;
```

Then run `npx prisma generate` to update the client. Note in the report that the migration file was hand-written and will be applied by the runtime `prisma migrate deploy` on next server boot.

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add User.suspended flag"
```

---

## Task 4: `/api/admin/summary` route

**Files:**
- Create: `src/app/api/admin/summary/route.ts`

**Interfaces:**
- Consumes: `auth()` (from `@/auth`), `getClient()` from `@/lib/data/clickhouse`, prisma client (from `@/lib/db` — check existing usage in `src/app/api/portfolio/route.ts` to confirm the exact import path used elsewhere), everything from `@/lib/data/metrics`.
- Produces:
  - `GET` returns JSON:
    ```ts
    interface AdminSummary {
      generatedAt: string; // ISO
      signal: {
        latestSnapshotAt: string | null;
        roleSplit: { primary: number; secondary: number; none: number; retained: number };
        pupHistogram: Array<{ bucket: number; n: number }>; // primary only, buckets of 0.02
        topStars: Array<{ symbol: string; role: string; net: number; pUp: number }>;
        primaryCountSpark: Array<{ ts: string; n: number }>; // last hour
      };
      pipeline: {
        alpacaSuccess1h: number;   // 0..1
        fundamentalsCacheHit: number | null; // 0..1 or null when unknown
        chBars24h: number;
        chScanRows24h: number;
        scanP95Ms: number;
      };
      business: {
        totalUsers: number;
        usersByRole: { USER: number; PREMIUM: number; ADMIN: number };
        signups7d: number;
        recentSignups: Array<{ id: string; email: string; role: string; createdAt: string }>;
        mrrStub: number;  // count(PREMIUM) * 19
      };
    }
    ```

**Server-side cache:** module-scope `{ payload, ts }` singleton with 10-second TTL.

- [ ] **Step 1: Confirm the prisma client import path used by the project**

Open `src/app/api/portfolio/route.ts` and locate the import for the prisma client. Note the exact path (likely `@/lib/db` or `@/lib/prisma`) — use it verbatim in Step 2.

- [ ] **Step 2: Create the route**

Create `src/app/api/admin/summary/route.ts`:

```ts
// Admin dashboard summary endpoint. Session-gated to ADMIN only.
// Server-side cache: 10s TTL to protect CH from multi-tab hammering.
// Spec: docs/superpowers/specs/2026-07-07-admin-dashboard-design.md

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db"; // <-- REPLACE with the actual path found in Step 1
import { getAlpacaSuccessRate, getScanLatencyP95 } from "@/lib/data/metrics";
import { createClient } from "@clickhouse/client";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 10_000;
let cache: { payload: AdminSummary; ts: number } | null = null;

// -- Shape shared with the client ---------------------------------------------
export interface AdminSummary {
  generatedAt: string;
  signal: {
    latestSnapshotAt: string | null;
    roleSplit: { primary: number; secondary: number; none: number; retained: number };
    pupHistogram: Array<{ bucket: number; n: number }>;
    topStars: Array<{ symbol: string; role: string; net: number; pUp: number }>;
    primaryCountSpark: Array<{ ts: string; n: number }>;
  };
  pipeline: {
    alpacaSuccess1h: number;
    fundamentalsCacheHit: number | null;
    chBars24h: number;
    chScanRows24h: number;
    scanP95Ms: number;
  };
  business: {
    totalUsers: number;
    usersByRole: { USER: number; PREMIUM: number; ADMIN: number };
    signups7d: number;
    recentSignups: Array<{ id: string; email: string; role: string; createdAt: string }>;
    mrrStub: number;
  };
}

// -- Lazy CH client (fail-open if URL unset) ---------------------------------
let chClient: ReturnType<typeof createClient> | null = null;
let chInit = false;
function getCh(): ReturnType<typeof createClient> | null {
  if (chInit) return chClient;
  chInit = true;
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  try {
    chClient = createClient({
      url,
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DB ?? "default",
    });
    return chClient;
  } catch {
    return null;
  }
}

async function chJson<T>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
  const c = getCh();
  if (!c) return [];
  try {
    const rs = await c.query({ query: sql, query_params: params ?? {}, format: "JSONEachRow" });
    return (await rs.json()) as T[];
  } catch (err) {
    console.warn("[admin/summary] CH query failed:", err);
    return [];
  }
}

// -- Section fetchers --------------------------------------------------------

async function fetchSignal() {
  const [latestRow] = await chJson<{ latest: string | null }>(
    `SELECT toString(max(generated_at)) AS latest FROM scan_snapshots`,
  );
  const latestSnapshotAt = latestRow?.latest ?? null;

  const roleRows = await chJson<{ role: string; n: number }>(
    `SELECT role, count() AS n FROM scan_rows
     WHERE generated_at = (SELECT max(generated_at) FROM scan_rows)
     GROUP BY role`,
  );
  const roleSplit = { primary: 0, secondary: 0, none: 0, retained: 0 };
  for (const r of roleRows) {
    if (r.role === "primary" || r.role === "secondary" || r.role === "none" || r.role === "retained") {
      roleSplit[r.role] = Number(r.n);
    }
  }

  const pupHistogram = await chJson<{ bucket: number; n: number }>(
    `SELECT round(p_up, 2) AS bucket, count() AS n
     FROM scan_rows
     WHERE generated_at = (SELECT max(generated_at) FROM scan_rows)
       AND role = 'primary'
     GROUP BY bucket
     ORDER BY bucket`,
  );

  const topStars = await chJson<{ symbol: string; role: string; net: number; pUp: number }>(
    `SELECT symbol, role, net, p_up AS pUp
     FROM scan_rows
     WHERE decision = 'BUY' AND star = 1
       AND generated_at = (SELECT max(generated_at) FROM scan_rows)
     ORDER BY net DESC
     LIMIT 5`,
  );

  const primaryCountSpark = await chJson<{ ts: string; n: number }>(
    `SELECT toString(generated_at) AS ts, countIf(role = 'primary') AS n
     FROM scan_rows
     WHERE generated_at >= now() - INTERVAL 1 HOUR
     GROUP BY generated_at
     ORDER BY generated_at`,
  );

  return { latestSnapshotAt, roleSplit, pupHistogram, topStars, primaryCountSpark };
}

async function fetchPipeline() {
  const [barsRow] = await chJson<{ n: number }>(
    `SELECT count() AS n FROM bars WHERE ts >= now() - INTERVAL 24 HOUR`,
  );
  const [scanRow] = await chJson<{ n: number }>(
    `SELECT count() AS n FROM scan_rows WHERE generated_at >= now() - INTERVAL 24 HOUR`,
  );
  return {
    alpacaSuccess1h: getAlpacaSuccessRate(),
    fundamentalsCacheHit: null, // Populated when sidecar /stats exists — see spec §Deferred.
    chBars24h: Number(barsRow?.n ?? 0),
    chScanRows24h: Number(scanRow?.n ?? 0),
    scanP95Ms: getScanLatencyP95(),
  };
}

async function fetchBusiness() {
  const [totalUsers, roleGroups, signups7d, recentSignups] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, email: true, role: true, createdAt: true },
    }),
  ]);
  const usersByRole = { USER: 0, PREMIUM: 0, ADMIN: 0 };
  for (const g of roleGroups) {
    const key = g.role as keyof typeof usersByRole;
    if (key in usersByRole) usersByRole[key] = g._count._all;
  }
  return {
    totalUsers,
    usersByRole,
    signups7d,
    recentSignups: recentSignups.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
    mrrStub: usersByRole.PREMIUM * 19,
  };
}

// -- Route handler -----------------------------------------------------------
export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }

  const [signal, pipeline, business] = await Promise.all([
    fetchSignal(),
    fetchPipeline(),
    fetchBusiness(),
  ]);
  const payload: AdminSummary = {
    generatedAt: new Date().toISOString(),
    signal,
    pipeline,
    business,
  };
  cache = { payload, ts: Date.now() };
  return NextResponse.json(payload);
}
```

Replace `@/lib/db` with the actual prisma import path from Step 1.

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors. If a mismatch on `role` types (Prisma enum vs string literals) appears, add an explicit `as string` cast in the `for (const g of roleGroups)` loop.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/summary/route.ts
git commit -m "feat(admin): summary API (signal/pipeline/business) with 10s cache"
```

---

## Task 5: `/api/admin/activity` route

**Files:**
- Create: `src/app/api/admin/activity/route.ts`

**Interfaces:**
- Consumes: `auth()`, prisma, CH client (via the same lazy singleton pattern as Task 4 — copy `getCh()` and `chJson<T>()` verbatim; do NOT extract to a shared file yet, keep boundaries tight), `getErrors` from metrics.
- Produces:
  - `GET /api/admin/activity?limit=50` returns:
    ```ts
    interface AdminActivityResponse {
      events: Array<AdminActivityEvent>;
    }
    type AdminActivityEvent =
      | { id: string; kind: "scan"; ts: string; symbolsScanned: number; primary: number; stars: number }
      | { id: string; kind: "star-in";  ts: string; symbol: string }
      | { id: string; kind: "star-out"; ts: string; symbol: string }
      | { id: string; kind: "signup"; ts: string; userId: string; email: string; role: string }
      | { id: string; kind: "error"; ts: string; errorId: string; errKind: "alpaca" | "ch" | "fundamentals"; message: string };
    ```
- Feed window: last 4 hours OR 100 events, whichever is smaller.

- [ ] **Step 1: Create the route**

Create `src/app/api/admin/activity/route.ts`:

```ts
// Admin activity feed. Mixed sources: CH scans + star transitions + postgres
// signups + in-memory errors. Session-gated to ADMIN only.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db"; // <-- REPLACE per Task 4 Step 1
import { getErrors } from "@/lib/data/metrics";
import { createClient } from "@clickhouse/client";

export const dynamic = "force-dynamic";

export type AdminActivityEvent =
  | { id: string; kind: "scan";       ts: string; symbolsScanned: number; primary: number; stars: number }
  | { id: string; kind: "star-in";    ts: string; symbol: string }
  | { id: string; kind: "star-out";   ts: string; symbol: string }
  | { id: string; kind: "signup";     ts: string; userId: string; email: string; role: string }
  | { id: string; kind: "error";      ts: string; errorId: string; errKind: "alpaca" | "ch" | "fundamentals"; message: string };

export interface AdminActivityResponse { events: AdminActivityEvent[] }

// -- Lazy CH client ----------------------------------------------------------
let chClient: ReturnType<typeof createClient> | null = null;
let chInit = false;
function getCh(): ReturnType<typeof createClient> | null {
  if (chInit) return chClient;
  chInit = true;
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  try {
    chClient = createClient({
      url,
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DB ?? "default",
    });
    return chClient;
  } catch { return null; }
}

async function chJson<T>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
  const c = getCh();
  if (!c) return [];
  try {
    const rs = await c.query({ query: sql, query_params: params ?? {}, format: "JSONEachRow" });
    return (await rs.json()) as T[];
  } catch { return []; }
}

async function fetchScanEvents(): Promise<AdminActivityEvent[]> {
  const rows = await chJson<{ id: string; ts: string; symbolsScanned: number; primary: number; stars: number }>(
    `SELECT
       toString(s.id) AS id,
       toString(s.generated_at) AS ts,
       s.symbols_scanned AS symbolsScanned,
       countIf(r.role = 'primary') AS primary,
       countIf(r.star = 1) AS stars
     FROM scan_snapshots s
     LEFT JOIN scan_rows r
       ON r.generated_at = s.generated_at
     WHERE s.generated_at >= now() - INTERVAL 4 HOUR
     GROUP BY s.id, s.generated_at, s.symbols_scanned
     ORDER BY s.generated_at DESC
     LIMIT 40`,
  );
  return rows.map((r) => ({
    id: `scan-${r.id}`,
    kind: "scan" as const,
    ts: r.ts,
    symbolsScanned: Number(r.symbolsScanned),
    primary: Number(r.primary),
    stars: Number(r.stars),
  }));
}

async function fetchStarTransitions(): Promise<AdminActivityEvent[]> {
  // Get the last 20 scans' star sets ordered oldest→newest, then diff pairs.
  const rows = await chJson<{ ts: string; symbols: string[] }>(
    `SELECT toString(generated_at) AS ts,
            groupArrayIf(symbol, star = 1) AS symbols
     FROM scan_rows
     WHERE generated_at >= now() - INTERVAL 4 HOUR
     GROUP BY generated_at
     ORDER BY generated_at ASC
     LIMIT 40`,
  );
  const events: AdminActivityEvent[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = new Set(rows[i - 1].symbols);
    const curr = new Set(rows[i].symbols);
    for (const s of curr) if (!prev.has(s)) events.push({ id: `star-in-${rows[i].ts}-${s}`, kind: "star-in", ts: rows[i].ts, symbol: s });
    for (const s of prev) if (!curr.has(s)) events.push({ id: `star-out-${rows[i].ts}-${s}`, kind: "star-out", ts: rows[i].ts, symbol: s });
  }
  return events;
}

async function fetchSignups(): Promise<AdminActivityEvent[]> {
  const cutoff = new Date(Date.now() - 4 * 3600 * 1000);
  const users = await prisma.user.findMany({
    where: { createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, createdAt: true },
    take: 30,
  });
  return users.map((u) => ({
    id: `signup-${u.id}`,
    kind: "signup" as const,
    ts: u.createdAt.toISOString(),
    userId: u.id,
    email: u.email,
    role: u.role,
  }));
}

function fetchErrorEvents(): AdminActivityEvent[] {
  const cutoff = Date.now() - 4 * 3600 * 1000;
  return getErrors(50)
    .filter((e) => e.ts >= cutoff)
    .map((e) => ({
      id: `err-${e.id}`,
      kind: "error" as const,
      ts: new Date(e.ts).toISOString(),
      errorId: e.id,
      errKind: e.kind,
      message: e.message,
    }));
}

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));

  const [scans, stars, signups] = await Promise.all([
    fetchScanEvents(),
    fetchStarTransitions(),
    fetchSignups(),
  ]);
  const errors = fetchErrorEvents();

  const all: AdminActivityEvent[] = [...scans, ...stars, ...signups, ...errors];
  all.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));

  return NextResponse.json({ events: all.slice(0, limit) } satisfies AdminActivityResponse);
}
```

Replace the `@/lib/db` import per Task 4 Step 1.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no new errors. If the `satisfies` operator flags because of TypeScript version, replace `satisfies AdminActivityResponse` with a preceding cast: `const resp: AdminActivityResponse = { events: all.slice(0, limit) }; return NextResponse.json(resp);`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/activity/route.ts
git commit -m "feat(admin): activity feed API (scans + star transitions + signups + errors)"
```

---

## Task 6: User admin API routes

**Files:**
- Create: `src/app/api/admin/users/[id]/route.ts` (GET user detail)
- Create: `src/app/api/admin/users/[id]/role/route.ts` (POST role)
- Create: `src/app/api/admin/users/[id]/suspend/route.ts` (POST suspend)

**Interfaces:**
- Consumes: `auth()`, prisma client.
- Produces:
  - `GET /api/admin/users/[id]` → `{ id, email, username, name, role, suspended, createdAt, portfolio: [...], watchlist: [...] }`
  - `POST /api/admin/users/[id]/role` body `{ role: "USER" | "PREMIUM" | "ADMIN" }` → `{ ok: true }`
  - `POST /api/admin/users/[id]/suspend` body `{ suspended: boolean }` → `{ ok: true }`

- [ ] **Step 1: Create user detail GET route**

Create `src/app/api/admin/users/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db"; // <-- REPLACE per Task 4 Step 1

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, username: true, name: true, image: true,
      role: true, suspended: true, createdAt: true,
      portfolio: { select: { symbol: true, qty: true, costBasis: true } },
      watchlist: { select: { symbol: true } },
    },
  });
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    ...user,
    createdAt: user.createdAt.toISOString(),
  });
}
```

- [ ] **Step 2: Create role override route**

Create `src/app/api/admin/users/[id]/role/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db"; // <-- REPLACE per Task 4 Step 1

const ALLOWED_ROLES = new Set(["USER", "PREMIUM", "ADMIN"]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null) as { role?: string } | null;
  if (!body || !body.role || !ALLOWED_ROLES.has(body.role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  await prisma.user.update({
    where: { id },
    // Cast to the prisma-generated Role enum via string literal — Prisma accepts
    // the exact string value at runtime; TypeScript's enum type flows in via
    // the schema-generated types.
    data: { role: body.role as "USER" | "PREMIUM" | "ADMIN" },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Create suspend route**

Create `src/app/api/admin/users/[id]/suspend/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db"; // <-- REPLACE per Task 4 Step 1

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null) as { suspended?: boolean } | null;
  if (!body || typeof body.suspended !== "boolean") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  await prisma.user.update({ where: { id }, data: { suspended: body.suspended } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/users/
git commit -m "feat(admin): user detail/role/suspend API endpoints"
```

---

## Task 7: Client polling hooks (`useSummaryPolling`, `useActivityPolling`, `useAge`)

**Files:**
- Create: `src/app/admin/hooks/useSummaryPolling.ts`
- Create: `src/app/admin/hooks/useActivityPolling.ts`
- Create: `src/app/admin/hooks/useAge.ts`

**Interfaces:**
- Consumes: types from Tasks 4 & 5 — import via type-only imports so the client bundle stays small.
- Produces:
  - `useSummaryPolling(): { data: AdminSummary | null; loading: boolean; error: string | null; refreshedAt: number | null }`
  - `useActivityPolling(enabled: boolean, limit?: number): { events: AdminActivityEvent[]; loading: boolean; error: string | null }`
  - `useAge(ts: number | null): number` — seconds since ts, ticks every 1s.

- [ ] **Step 1: Create useSummaryPolling**

Create `src/app/admin/hooks/useSummaryPolling.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import type { AdminSummary } from "@/app/api/admin/summary/route";

const POLL_MS = 12_000;

export function useSummaryPolling() {
  const [data, setData] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchOnce = async () => {
      try {
        const r = await fetch("/api/admin/summary", { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const json = (await r.json()) as AdminSummary;
        if (!alive) return;
        setData(json);
        setError(null);
        setRefreshedAt(Date.now());
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "unknown");
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchOnce();
    const t = setInterval(fetchOnce, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return { data, loading, error, refreshedAt };
}
```

- [ ] **Step 2: Create useActivityPolling**

Create `src/app/admin/hooks/useActivityPolling.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import type { AdminActivityEvent } from "@/app/api/admin/activity/route";

const POLL_MS = 12_000;

export function useActivityPolling(enabled: boolean, limit = 50) {
  const [events, setEvents] = useState<AdminActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const fetchOnce = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/admin/activity?limit=${limit}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const json = (await r.json()) as { events: AdminActivityEvent[] };
        if (!alive) return;
        setEvents(json.events);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "unknown");
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchOnce();
    const t = setInterval(fetchOnce, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [enabled, limit]);

  return { events, loading, error };
}
```

- [ ] **Step 3: Create useAge**

Create `src/app/admin/hooks/useAge.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

// Returns seconds since `ts` (server-provided ms epoch). Ticks every 1s.
// Returns null when ts is null.
export function useAge(ts: number | null): number | null {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (ts == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ts]);
  if (ts == null) return null;
  return Math.max(0, Math.floor((now - ts) / 1000));
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/hooks/
git commit -m "feat(admin): polling hooks (summary, activity, age)"
```

---

## Task 8: Main dashboard shell + three sections

**Files:**
- Modify: `src/app/admin/page.tsx` — replace stub with thin server component.
- Create: `src/app/admin/AdminDashboard.tsx` — main client component.
- Create: `src/app/admin/sections/SignalQualitySection.tsx`
- Create: `src/app/admin/sections/PipelineHealthSection.tsx`
- Create: `src/app/admin/sections/BusinessSection.tsx`

**Interfaces:**
- Consumes: hooks from Task 7, types from Tasks 4/5, existing `Card`, `CardContent`, `CardHeader`, `CardTitle` from `@/components/ui/card`, `Badge` from `@/components/ui/badge`, `cn` from `@/lib/utils`.
- Produces:
  - `<AdminDashboard />` — renders header + 3 sections + drawer trigger. Drawer components come in Task 9.

The three section components receive the summary data as props and render their portion. They render skeleton states when data is null.

- [ ] **Step 1: Replace `src/app/admin/page.tsx`**

Overwrite with:

```tsx
import { AdminDashboard } from "./AdminDashboard";

// Middleware already gates /admin to ADMIN role — no in-page auth check needed.
export default function AdminPage() {
  return <AdminDashboard />;
}
```

- [ ] **Step 2: Create AdminDashboard shell (drawer state; sections import in later steps)**

Create `src/app/admin/AdminDashboard.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSummaryPolling } from "./hooks/useSummaryPolling";
import { useAge } from "./hooks/useAge";
import { SignalQualitySection } from "./sections/SignalQualitySection";
import { PipelineHealthSection } from "./sections/PipelineHealthSection";
import { BusinessSection } from "./sections/BusinessSection";

const DRAWER_STORAGE_KEY = "admin.activityDrawer";

export function AdminDashboard() {
  const { data, error, refreshedAt } = useSummaryPolling();
  const age = useAge(refreshedAt);

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Hydrate from localStorage after mount to avoid SSR hydration mismatch.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(DRAWER_STORAGE_KEY);
      if (v === "1") setDrawerOpen(true);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAWER_STORAGE_KEY, drawerOpen ? "1" : "0");
    } catch { /* ignore */ }
  }, [drawerOpen]);

  return (
    <main className="relative flex flex-1 flex-col px-6 py-8">
      <div className="mx-auto w-full max-w-[1280px] space-y-4">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-low px-5 py-3">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-on-surface">
              ◆ Admin Console
            </h1>
            <Badge tone="primary" led>ADMIN</Badge>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px] text-on-surface-variant">
            <span className={cn(
              "inline-flex items-center gap-1.5",
              error ? "text-error" : "text-success",
            )}>
              <span className={cn(
                "inline-block h-2 w-2 rounded-full",
                error ? "bg-error" : "bg-success",
              )} />
              {error ? `ERR · ${error}` : "LIVE"}
            </span>
            {age != null && <span>updated {age}s ago</span>}
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className={cn(
                "rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                drawerOpen
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface-lowest text-on-surface-variant hover:text-on-surface",
              )}
            >
              ◆ Activity
            </button>
          </div>
        </div>

        {/* Sections */}
        <SignalQualitySection signal={data?.signal ?? null} />
        <PipelineHealthSection pipeline={data?.pipeline ?? null} />
        <BusinessSection business={data?.business ?? null} />

      </div>
    </main>
  );
}
```

Note: `SymbolDrillDrawer` and `ActivityDrawer` are added by Tasks 9 and 10; leave imports out for now.

- [ ] **Step 3: Create SignalQualitySection**

Create `src/app/admin/sections/SignalQualitySection.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSummary } from "@/app/api/admin/summary/route";

type Signal = AdminSummary["signal"];

export function SignalQualitySection({ signal }: { signal: Signal | null }) {
  if (!signal) {
    return <SectionCard title="Signal quality" subtitle="loading…"><Loading /></SectionCard>;
  }
  const { roleSplit, pupHistogram, topStars } = signal;
  const total = roleSplit.primary + roleSplit.secondary + roleSplit.none + roleSplit.retained;
  const maxHist = Math.max(1, ...pupHistogram.map((p) => p.n));

  return (
    <SectionCard
      title="Signal quality"
      subtitle={signal.latestSnapshotAt
        ? `latest ${signal.latestSnapshotAt.slice(11, 19)}`
        : "no scans yet"}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Left: role split + pUp histogram */}
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            Roles · {total} symbols
          </div>
          <div className="mb-1 flex items-baseline gap-2 font-mono text-sm">
            <span className="text-on-surface font-semibold">{roleSplit.primary}</span>
            <span className="text-[11px] text-on-surface-variant">primary</span>
            <span className="text-on-surface-variant">·</span>
            <span className="text-on-surface font-semibold">{roleSplit.secondary}</span>
            <span className="text-[11px] text-on-surface-variant">secondary</span>
            <span className="text-on-surface-variant">·</span>
            <span className="text-[11px] text-on-surface-variant">{roleSplit.none} none</span>
          </div>

          <div className="mt-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              pUp distribution · primary only
            </div>
            <div className="flex h-10 items-end gap-[1px]">
              {pupHistogram.map((b) => {
                const h = (b.n / maxHist) * 100;
                return (
                  <div
                    key={b.bucket}
                    title={`pUp ${b.bucket.toFixed(2)} · ${b.n} rows`}
                    style={{ height: `${Math.max(4, h)}%` }}
                    className={cn(
                      "flex-1 border-t",
                      h > 60 ? "bg-success border-success" : "bg-success/50 border-success/70",
                    )}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: top 5 stars */}
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            Top 5 stars
          </div>
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="text-on-surface-variant">
                <th className="w-4"></th>
                <th className="text-left">sym</th>
                <th className="text-left">role</th>
                <th className="text-right">net</th>
                <th className="text-right">pUp</th>
              </tr>
            </thead>
            <tbody>
              {topStars.length === 0 ? (
                <tr><td colSpan={5} className="py-2 text-on-surface-variant">no stars yet</td></tr>
              ) : topStars.map((s) => (
                <tr key={s.symbol} className="border-t border-border/50">
                  <td className="text-tertiary">★</td>
                  <td className="text-on-surface font-semibold">{s.symbol}</td>
                  <td className="text-on-surface-variant">{s.role}</td>
                  <td className="text-right text-success">+{s.net.toFixed(1)}</td>
                  <td className="text-right text-on-surface-variant">{s.pUp.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}

// -- Small shared shell -------------------------------------------------------

function SectionCard({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>▸ {title}</CardTitle>
        {subtitle && <span className="font-mono text-[10px] text-on-surface-variant">{subtitle}</span>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Loading() {
  return <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>;
}
```

- [ ] **Step 4: Create PipelineHealthSection**

Create `src/app/admin/sections/PipelineHealthSection.tsx`:

```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSummary } from "@/app/api/admin/summary/route";

type Pipeline = AdminSummary["pipeline"];

export function PipelineHealthSection({ pipeline }: { pipeline: Pipeline | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>▸ Pipeline health</CardTitle>
        <span className="font-mono text-[10px] text-on-surface-variant">alpaca · ch · fund</span>
      </CardHeader>
      <CardContent>
        {!pipeline ? (
          <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Alpaca" value={`${(pipeline.alpacaSuccess1h * 100).toFixed(1)}%`} sub="1h success" />
            <Stat
              label="Cache hit"
              value={pipeline.fundamentalsCacheHit == null
                ? "n/a"
                : `${(pipeline.fundamentalsCacheHit * 100).toFixed(0)}%`}
              sub="fundamentals"
            />
            <Stat label="CH bars" value={fmtCount(pipeline.chBars24h)} sub="/24h" />
            <Stat label="CH rows" value={fmtCount(pipeline.chScanRows24h)} sub="scan_rows /24h" />
            <Stat label="Scan p95" value={`${pipeline.scanP95Ms.toFixed(0)}ms`} sub="build snapshot" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">{label}</div>
      <div className="font-mono text-lg font-semibold text-on-surface">{value}</div>
      <div className="font-mono text-[10px] text-on-surface-variant">{sub}</div>
    </div>
  );
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
```

- [ ] **Step 5: Create BusinessSection**

Create `src/app/admin/sections/BusinessSection.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSummary } from "@/app/api/admin/summary/route";

type Business = AdminSummary["business"];

export function BusinessSection({ business }: { business: Business | null }) {
  if (!business) {
    return (
      <Card>
        <CardHeader><CardTitle>▸ Business</CardTitle></CardHeader>
        <CardContent><div className="font-mono text-[11px] text-on-surface-variant">loading…</div></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>▸ Business · 30d</CardTitle>
        <span className="font-mono text-[10px] text-on-surface-variant">postgres</span>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              Users · by role
            </div>
            <div className="font-mono text-sm text-on-surface">
              <span className="font-semibold">{business.totalUsers}</span> total ·
              {" "}<span>{business.usersByRole.USER} free</span> ·
              {" "}<span>{business.usersByRole.PREMIUM} premium</span> ·
              {" "}<span>{business.usersByRole.ADMIN} admin</span>
            </div>
            <div className="mt-2 font-mono text-[10px] text-on-surface-variant">
              +{business.signups7d} signups last 7d
            </div>
            <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              MRR (stub)
            </div>
            <div className="font-mono text-lg font-semibold text-on-surface">${business.mrrStub}</div>
            <div className="font-mono text-[10px] text-on-surface-variant">stripe not wired</div>
          </div>
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              Recent signups
            </div>
            <table className="w-full font-mono text-[11px]">
              <tbody>
                {business.recentSignups.length === 0 ? (
                  <tr><td className="text-on-surface-variant">no recent signups</td></tr>
                ) : business.recentSignups.map((u) => (
                  <tr key={u.id} className="border-t border-border/50">
                    <td className="text-on-surface-variant py-1">{u.createdAt.slice(11, 16)}</td>
                    <td className="py-1">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="text-on-surface hover:text-primary hover:underline"
                      >
                        {u.email}
                      </Link>
                    </td>
                    <td className="text-on-surface-variant py-1 text-right">{u.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/page.tsx src/app/admin/AdminDashboard.tsx src/app/admin/sections/
git commit -m "feat(admin): dashboard shell with signal/pipeline/business sections"
```

---

## Task 9: Activity drawer + inline event expand

**Files:**
- Create: `src/app/admin/ActivityDrawer.tsx`
- Modify: `src/app/admin/AdminDashboard.tsx` — wire the drawer in.

**Interfaces:**
- Consumes: `useActivityPolling` from Task 7; `AdminActivityEvent` type from Task 5.
- Produces:
  - `<ActivityDrawer open onClose onSymbolClick />` component. `onSymbolClick(symbol)` fired when the user clicks the "star-in" / "star-out" event to see the symbol's history (wired to SymbolDrillDrawer in Task 10; for this task, accept the prop and stub it as no-op-safe).

- [ ] **Step 1: Create the drawer**

Create `src/app/admin/ActivityDrawer.tsx`:

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useActivityPolling } from "./hooks/useActivityPolling";
import type { AdminActivityEvent } from "@/app/api/admin/activity/route";

interface Props {
  open: boolean;
  onClose: () => void;
  onSymbolClick?: (symbol: string) => void;
}

export function ActivityDrawer({ open, onClose, onSymbolClick }: Props) {
  const { events, loading, error } = useActivityPolling(open);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Activity feed"
      className="fixed right-0 top-16 z-40 flex h-[calc(100vh-4rem)] w-[320px] flex-col border-l border-border bg-surface-low shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="font-mono text-[11px] uppercase tracking-wider text-primary">▸ Activity</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close activity drawer"
          className="font-mono text-xs text-on-surface-variant hover:text-on-surface"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {loading && events.length === 0 && (
          <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>
        )}
        {error && (
          <div className="font-mono text-[11px] text-error">error · {error}</div>
        )}
        {events.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            expanded={expandedId === e.id}
            onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
            onSymbolClick={onSymbolClick}
          />
        ))}
        {!loading && events.length === 0 && (
          <div className="font-mono text-[11px] text-on-surface-variant">quiet · no events in window</div>
        )}
      </div>
    </div>
  );
}

function EventRow({
  event, expanded, onToggle, onSymbolClick,
}: {
  event: AdminActivityEvent;
  expanded: boolean;
  onToggle: () => void;
  onSymbolClick?: (symbol: string) => void;
}) {
  const time = event.ts.slice(11, 16); // HH:MM

  const kindStyle: Record<AdminActivityEvent["kind"], string> = {
    "scan":     "text-primary",
    "star-in":  "text-tertiary",
    "star-out": "text-tertiary",
    "signup":   "text-secondary",
    "error":    "text-error",
  };

  const summary = renderSummary(event);

  return (
    <div className="border-b border-border/40 py-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[38px_58px_1fr] items-baseline gap-2 text-left font-mono text-[11px]"
      >
        <span className="text-on-surface-variant">{time}</span>
        <span className={cn(kindStyle[event.kind])}>{event.kind}</span>
        <span className="text-on-surface truncate">{summary}</span>
      </button>
      {expanded && (
        <div className="mt-1 rounded border border-border bg-surface-lowest px-2 py-1 font-mono text-[10px] text-on-surface-variant">
          {renderExpansion(event, onSymbolClick)}
        </div>
      )}
    </div>
  );
}

function renderSummary(e: AdminActivityEvent): string {
  switch (e.kind) {
    case "scan": return `${e.symbolsScanned} sym · ${e.primary} primary · ${e.stars} stars`;
    case "star-in":  return `${e.symbol} entered top-5`;
    case "star-out": return `${e.symbol} dropped from top-5`;
    case "signup": return `${e.email} (${e.role})`;
    case "error": return `${e.errKind} · ${e.message.slice(0, 60)}`;
  }
}

function renderExpansion(
  e: AdminActivityEvent,
  onSymbolClick?: (symbol: string) => void,
): React.ReactNode {
  switch (e.kind) {
    case "scan": return `snapshot @ ${e.ts}`;
    case "star-in":
    case "star-out":
      return onSymbolClick ? (
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => onSymbolClick(e.symbol)}
        >
          view {e.symbol} history →
        </button>
      ) : `symbol ${e.symbol}`;
    case "signup":
      return `user id: ${e.userId}`;
    case "error":
      return e.message;
  }
}
```

- [ ] **Step 2: Wire the drawer into AdminDashboard**

Open `src/app/admin/AdminDashboard.tsx`. Add the import at the top:

```tsx
import { ActivityDrawer } from "./ActivityDrawer";
```

Add the drawer at the bottom of the `<main>` element, just before its closing tag:

```tsx
      </div>
      <ActivityDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </main>
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/ActivityDrawer.tsx src/app/admin/AdminDashboard.tsx
git commit -m "feat(admin): activity drawer with inline event expand"
```

---

## Task 10: Symbol drill drawer

**Files:**
- Create: `src/app/admin/SymbolDrillDrawer.tsx`
- Modify: `src/app/admin/AdminDashboard.tsx` — manage a `focusedSymbol` state; wire clicks from the SignalQualitySection top-5 table and from the ActivityDrawer.
- Modify: `src/app/admin/sections/SignalQualitySection.tsx` — accept an `onSymbolClick` prop and wire the top-5 rows.

**Interfaces:**
- Consumes: nothing new server-side (uses `fetch("/api/admin/summary")` results indirectly via a fresh CH query — see Step 1 for a small dedicated fetch).
- Produces:
  - `<SymbolDrillDrawer symbol onClose />` component.
  - `SignalQualitySection` gets a new optional `onSymbolClick?: (symbol: string) => void` prop.

**Data:** the drawer fetches the symbol's history from a small new endpoint. Add `GET /api/admin/symbol/[symbol]/route.ts` (part of this task) that returns the last 20 scan_rows.

- [ ] **Step 1: Create the symbol history API route**

Create `src/app/api/admin/symbol/[symbol]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient } from "@clickhouse/client";

export const dynamic = "force-dynamic";

export interface SymbolHistoryResponse {
  symbol: string;
  history: Array<{ generatedAt: string; net: number; role: string; decision: string; star: number; price: number }>;
}

let chClient: ReturnType<typeof createClient> | null = null;
let chInit = false;
function getCh() {
  if (chInit) return chClient;
  chInit = true;
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  try {
    chClient = createClient({
      url,
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DB ?? "default",
    });
    return chClient;
  } catch { return null; }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { symbol } = await params;
  const c = getCh();
  if (!c) return NextResponse.json({ symbol, history: [] } satisfies SymbolHistoryResponse);
  try {
    const rs = await c.query({
      query: `
        SELECT
          toString(generated_at) AS generatedAt,
          net, role, decision, star, price
        FROM scan_rows
        WHERE symbol = {symbol:String}
        ORDER BY generated_at DESC
        LIMIT 20
      `,
      query_params: { symbol },
      format: "JSONEachRow",
    });
    const history = (await rs.json()) as SymbolHistoryResponse["history"];
    return NextResponse.json({ symbol, history } satisfies SymbolHistoryResponse);
  } catch {
    return NextResponse.json({ symbol, history: [] } satisfies SymbolHistoryResponse);
  }
}
```

- [ ] **Step 2: Create the SymbolDrillDrawer component**

Create `src/app/admin/SymbolDrillDrawer.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SymbolHistoryResponse } from "@/app/api/admin/symbol/[symbol]/route";

interface Props {
  symbol: string;
  onClose: () => void;
}

export function SymbolDrillDrawer({ symbol, onClose }: Props) {
  const [data, setData] = useState<SymbolHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/admin/symbol/${encodeURIComponent(symbol)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const json = (await r.json()) as SymbolHistoryResponse;
        if (alive) setData(json);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "unknown");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [symbol]);

  const latest = data?.history?.[0];

  return (
    <div
      role="dialog"
      aria-label={`Symbol ${symbol}`}
      className="fixed right-0 top-16 z-50 flex h-[calc(100vh-4rem)] w-[360px] flex-col border-l border-border bg-surface-low shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-on-surface">{symbol}</span>
          {latest && (
            <>
              <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">{latest.role}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">·</span>
              <span className={cn(
                "font-mono text-[10px] uppercase tracking-wider",
                latest.decision === "BUY" ? "text-success" : "text-on-surface-variant",
              )}>{latest.decision}</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close symbol drawer"
          className="font-mono text-xs text-on-surface-variant hover:text-on-surface"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {loading && <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>}
        {error && <div className="font-mono text-[11px] text-error">error · {error}</div>}
        {data && !loading && (
          <>
            {latest && (
              <div className="mb-3 font-mono text-[11px] text-on-surface">
                current price · ${latest.price.toFixed(2)}
              </div>
            )}
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              Last {data.history.length} scans
            </div>
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="text-on-surface-variant">
                  <th className="text-left">time</th>
                  <th className="text-left">role</th>
                  <th className="text-right">net</th>
                  <th className="text-right">dec</th>
                  <th className="w-4"></th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((r, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="text-on-surface-variant">{r.generatedAt.slice(11, 19)}</td>
                    <td className="text-on-surface-variant">{r.role}</td>
                    <td className={cn(
                      "text-right",
                      r.net > 0 ? "text-success" : "text-on-surface-variant",
                    )}>{r.net > 0 ? "+" : ""}{r.net.toFixed(1)}</td>
                    <td className="text-right text-on-surface">{r.decision}</td>
                    <td className="text-tertiary">{r.star ? "★" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into SignalQualitySection**

Open `src/app/admin/sections/SignalQualitySection.tsx`. Change the component signature to accept a click handler:

```tsx
export function SignalQualitySection({
  signal,
  onSymbolClick,
}: {
  signal: Signal | null;
  onSymbolClick?: (symbol: string) => void;
}) {
```

Change the top-star row to be clickable:

```tsx
              ) : topStars.map((s) => (
                <tr
                  key={s.symbol}
                  className="cursor-pointer border-t border-border/50 hover:bg-surface-default"
                  onClick={() => onSymbolClick?.(s.symbol)}
                >
                  <td className="text-tertiary">★</td>
                  <td className="text-on-surface font-semibold">{s.symbol}</td>
                  <td className="text-on-surface-variant">{s.role}</td>
                  <td className="text-right text-success">+{s.net.toFixed(1)}</td>
                  <td className="text-right text-on-surface-variant">{s.pUp.toFixed(3)}</td>
                </tr>
              ))}
```

- [ ] **Step 4: Wire into AdminDashboard**

Open `src/app/admin/AdminDashboard.tsx`. Add the import:

```tsx
import { SymbolDrillDrawer } from "./SymbolDrillDrawer";
```

Add state:

```tsx
  const [focusedSymbol, setFocusedSymbol] = useState<string | null>(null);
```

Pass `onSymbolClick` to SignalQualitySection:

```tsx
        <SignalQualitySection signal={data?.signal ?? null} onSymbolClick={setFocusedSymbol} />
```

Pass `onSymbolClick` to ActivityDrawer:

```tsx
      <ActivityDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSymbolClick={setFocusedSymbol} />
```

Add the symbol drawer at the end of `<main>`:

```tsx
      {focusedSymbol && (
        <SymbolDrillDrawer symbol={focusedSymbol} onClose={() => setFocusedSymbol(null)} />
      )}
    </main>
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/SymbolDrillDrawer.tsx src/app/admin/sections/SignalQualitySection.tsx src/app/admin/AdminDashboard.tsx src/app/api/admin/symbol/
git commit -m "feat(admin): symbol drill drawer with 20-scan history"
```

---

## Task 11: User detail page (`/admin/users/[id]`)

**Files:**
- Create: `src/app/admin/users/[id]/page.tsx` — server component that fetches initial data and renders the client component.
- Create: `src/app/admin/users/[id]/UserDetailClient.tsx` — client component for role/suspend actions.

**Interfaces:**
- Consumes: `GET /api/admin/users/[id]`, `POST /api/admin/users/[id]/role`, `POST /api/admin/users/[id]/suspend` (from Task 6).
- Produces: the `/admin/users/[id]` route.

- [ ] **Step 1: Create the server page**

Create `src/app/admin/users/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { UserDetailClient, type UserDetail } from "./UserDetailClient";

export const dynamic = "force-dynamic";

async function fetchUser(id: string): Promise<UserDetail | null> {
  // Server-side fetch of our own API. Include cookies for auth.
  const res = await fetch(`${process.env.NEXTAUTH_URL ?? ""}/api/admin/users/${encodeURIComponent(id)}`, {
    cache: "no-store",
    headers: { cookie: "" }, // Populated by Next request context automatically when same-origin.
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`admin fetch ${res.status}`);
  return (await res.json()) as UserDetail;
}

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await fetchUser(id);
  if (!user) notFound();

  return (
    <main className="relative flex flex-1 flex-col px-6 py-8">
      <div className="mx-auto w-full max-w-[880px] space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-low px-5 py-3">
          <div className="flex items-baseline gap-3">
            <Link href="/admin" className="font-mono text-[11px] text-on-surface-variant hover:text-on-surface">
              ← admin
            </Link>
            <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-on-surface">
              ◆ User · {user.email}
            </h1>
          </div>
        </div>
        <UserDetailClient user={user} />
      </div>
    </main>
  );
}
```

Note: the `fetch` with `${process.env.NEXTAUTH_URL}` works for same-origin server components in Next 16; if server-side fetching to your own API is problematic in this codebase, an alternative is to move the query directly into `page.tsx` using the prisma client. If Step 6 (typecheck) reports issues with the self-fetch, replace the `fetchUser` implementation with a direct prisma query (same select set as `/api/admin/users/[id]/route.ts`).

- [ ] **Step 2: Create the client component with actions**

Create `src/app/admin/users/[id]/UserDetailClient.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface UserDetail {
  id: string;
  email: string;
  username: string;
  name: string | null;
  image: string | null;
  role: "USER" | "PREMIUM" | "ADMIN";
  suspended: boolean;
  createdAt: string;
  portfolio: Array<{ symbol: string; qty: number; costBasis: number }>;
  watchlist: Array<{ symbol: string }>;
}

export function UserDetailClient({ user }: { user: UserDetail }) {
  const [role, setRole] = useState<UserDetail["role"]>(user.role);
  const [suspended, setSuspended] = useState<boolean>(user.suspended);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const commitRole = (next: UserDetail["role"]) => {
    setErr(null);
    setRole(next);
    startTransition(async () => {
      const r = await fetch(`/api/admin/users/${user.id}/role`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      if (!r.ok) { setErr(`role update failed (${r.status})`); setRole(user.role); return; }
      router.refresh();
    });
  };
  const commitSuspend = (next: boolean) => {
    setErr(null);
    setSuspended(next);
    startTransition(async () => {
      const r = await fetch(`/api/admin/users/${user.id}/suspend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suspended: next }),
      });
      if (!r.ok) { setErr(`suspend update failed (${r.status})`); setSuspended(user.suspended); return; }
      router.refresh();
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>▸ Info</CardTitle></CardHeader>
        <CardContent>
          <dl className="space-y-1 font-mono text-[11px]">
            <Row label="id" value={user.id} />
            <Row label="email" value={user.email} />
            <Row label="username" value={user.username} />
            <Row label="name" value={user.name ?? "—"} />
            <Row label="created" value={user.createdAt.slice(0, 19).replace("T", " ")} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>▸ Actions</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">Role</div>
              <div className="flex gap-2">
                {(["USER", "PREMIUM", "ADMIN"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={pending}
                    onClick={() => commitRole(r)}
                    className={cn(
                      "rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider",
                      role === r
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-surface-lowest text-on-surface-variant hover:text-on-surface",
                    )}
                  >{r}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">Suspended</div>
              <button
                type="button"
                disabled={pending}
                onClick={() => commitSuspend(!suspended)}
                className={cn(
                  "rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider",
                  suspended
                    ? "border-error bg-error/10 text-error"
                    : "border-border bg-surface-lowest text-on-surface-variant hover:text-on-surface",
                )}
              >
                {suspended ? "suspended" : "active"}
              </button>
              <div className="mt-1 font-mono text-[10px] text-on-surface-variant">
                v1: flag only. Login enforcement is a follow-up.
              </div>
            </div>
            {err && <div className="font-mono text-[11px] text-error">{err}</div>}
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader><CardTitle>▸ Portfolio · {user.portfolio.length}</CardTitle></CardHeader>
        <CardContent>
          {user.portfolio.length === 0 ? (
            <div className="font-mono text-[11px] text-on-surface-variant">empty</div>
          ) : (
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="text-on-surface-variant">
                  <th className="text-left">symbol</th>
                  <th className="text-right">qty</th>
                  <th className="text-right">cost basis</th>
                </tr>
              </thead>
              <tbody>
                {user.portfolio.map((p) => (
                  <tr key={p.symbol} className="border-t border-border/50">
                    <td className="text-on-surface font-semibold">{p.symbol}</td>
                    <td className="text-right text-on-surface">{p.qty}</td>
                    <td className="text-right text-on-surface">${p.costBasis.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="text-on-surface">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: no errors. If Step 1's server-side self-fetch fails (missing NEXTAUTH_URL at build time, or forwarding cookies is awkward), swap the `fetchUser` implementation for a direct prisma query. Rework:

```tsx
import { auth } from "@/auth";
import { prisma } from "@/lib/db"; // <-- REPLACE per Task 4 Step 1
async function fetchUser(id: string): Promise<UserDetail | null> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return null;
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, username: true, name: true, image: true,
      role: true, suspended: true, createdAt: true,
      portfolio: { select: { symbol: true, qty: true, costBasis: true } },
      watchlist: { select: { symbol: true } },
    },
  });
  if (!u) return null;
  return { ...u, createdAt: u.createdAt.toISOString() } as UserDetail;
}
```

Note the fallback in your report if you take it.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/users/
git commit -m "feat(admin): user detail page with role + suspend actions"
```

---

## Task 12: End-to-end verification

**Files:** none modified — this task validates the whole stack.

**Interfaces:** none.

- [ ] **Step 1: Rebuild and boot**

Run:

```bash
docker compose up -d --build app
```

Wait ~30s.

- [ ] **Step 2: Confirm services healthy**

```bash
docker compose ps
```

Expected: `singscanner-pg`, `singscanner-ch`, `singscanner-fundamentals`, `singscanner-app` all `Up` / `healthy`.

- [ ] **Step 3: Confirm the migration applied**

```bash
docker exec singscanner-pg psql -U singscanner -d singscanner -c "\d \"User\""
```

Expected: the `suspended` column appears with type `boolean` and default `false`.

- [ ] **Step 4: Sign in as an ADMIN**

Ensure `ADMIN_EMAILS` env includes your login email and that your account exists with `role = ADMIN` (either via seed or by manually setting it: `docker exec singscanner-pg psql -U singscanner -d singscanner -c "UPDATE \"User\" SET role = 'ADMIN' WHERE email = 'you@example.com'"`).

Log in at `/login`, then navigate to `/admin`.

- [ ] **Step 5: Verify the three sections render**

Expected:
- Signal quality shows a role split (e.g. `16 primary · 59 secondary · 525 none`), a pUp histogram (bars visible), and a top-5 stars table.
- Pipeline health shows Alpaca %, cache hit (or `n/a`), CH bar / row counts, scan p95 in ms.
- Business shows users by role, signups last 7d, MRR stub, and 0–5 recent signups.
- Header shows a green LED + "LIVE" + "updated Xs ago" ticker.

- [ ] **Step 6: Verify the activity drawer**

Click "◆ ACTIVITY" in the header. Expected:
- Drawer slides in from the right; page content is not resized.
- Feed shows recent `scan` events (approx. one per 15s), any `signup` events in the last 4h, and errors if any.
- Click a `scan` row — it expands to show `snapshot @ ...` line.
- Click the header ✕ — drawer closes.
- Refresh the page — drawer state persists (open stays open).

- [ ] **Step 7: Verify the symbol drill**

Click one of the top-5 stars (e.g. `BAC`). Expected:
- Symbol drawer opens (may cover activity drawer).
- Header shows symbol + role + decision.
- History table shows up to 20 rows.
- Close via ✕.

- [ ] **Step 8: Verify the user detail page**

Click a recent signup email in Business. Expected:
- Navigates to `/admin/users/<id>`.
- Info card shows email/username/created.
- Actions card lets you toggle role and suspend.
- Toggle role to PREMIUM → refresh page → still PREMIUM.
- Toggle back to USER.
- Toggle suspended → verify with:

```bash
docker exec singscanner-pg psql -U singscanner -d singscanner -c "SELECT id, email, role, suspended FROM \"User\" WHERE email = '<test-email>'"
```

Expected: `suspended` reflects the toggle.

- [ ] **Step 9: Verify non-admin gets 403**

Log out. Log back in as a non-ADMIN user. Attempt to navigate to `/admin` — expect redirect to `/upgrade?reason=admin-only` (existing middleware behaviour).

Attempt to call the API directly with curl using the non-admin session cookie:

```bash
curl -i http://localhost:3097/api/admin/summary -H "cookie: <non-admin session cookie>"
```

Expected: `HTTP/1.1 403` with body `{"error":"forbidden"}`.

- [ ] **Step 10: Verify fail-open when CH is down**

```bash
docker compose stop clickhouse
```

Wait ~10s (for the app's 10s cache to expire), reload `/admin`. Expected:
- Signal quality section shows zeros (`0 primary · 0 secondary · 0 none`) with a "no scans yet" subtitle.
- Pipeline health shows CH bars/rows as `0`; Alpaca % and scan p95 populated from in-memory metrics.
- No client-visible errors.

Restart CH:

```bash
docker compose start clickhouse
```

- [ ] **Step 11: No commit for this task**

Validation only.

---

## Self-review

**Spec coverage:**
- ✅ Layout D2 with toggleable drawer (Tasks 8 + 9)
- ✅ Three sections: Signal / Pipeline / Business (Task 8)
- ✅ Activity feed with 5 event kinds (Task 5 + 9)
- ✅ Symbol drill (Task 10) + Activity event expand (Task 9) + User drill (Task 11)
- ✅ Metrics instrumentation module + wiring (Tasks 1 + 2)
- ✅ `User.suspended` migration (Task 3)
- ✅ Admin API routes ADMIN-gated (Tasks 4, 5, 6, 10)
- ✅ Polling every 12s + 10s server cache (Tasks 4 + 7)
- ✅ MRR stubbed with caption (Task 8 BusinessSection)
- ✅ Fundamentals cache hit rate flagged as `null`/`n/a` when unknown (Task 4 + 8)
- ✅ localStorage persist for drawer state (Task 8)
- ✅ Non-goals respected (no SSE, no editing calibration, no audit log)

**Placeholder scan:** No TBDs, no vague "handle errors appropriately". The one soft fallback (Task 11 Step 3: swap self-fetch for direct prisma if the self-fetch fails at build) is explicit and documented. The "REPLACE with actual prisma import" instruction in multiple tasks is grounded in Task 4 Step 1's investigation.

**Type consistency:**
- `AdminSummary` shape defined in Task 4, imported via type-only imports in Tasks 7 & 8.
- `AdminActivityEvent` union defined in Task 5, consumed by Task 7 (hooks) and Task 9 (drawer).
- `SymbolHistoryResponse` defined in Task 10, consumed within the same task.
- `UserDetail` interface defined in Task 11 and exported alongside the client component.
- `MetricsError` / `MetricsErrorKind` defined in Task 1, consumed by Task 2 (recording) and Task 5 (reading via `getErrors`).
- Prisma role type consistency: `"USER" | "PREMIUM" | "ADMIN"` literal union used consistently in Tasks 4, 6, 11; matches the schema enum in `prisma/schema.prisma`.
