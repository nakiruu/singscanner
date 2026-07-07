# Admin dashboard

**Date:** 2026-07-07
**Status:** Approved

## Goal

Replace the stub `/admin` page (three empty placeholder cards) with a working admin console that surfaces (1) live signal-quality metrics from the ClickHouse audit store, (2) pipeline health, (3) business/user data from postgres, and (4) an activity event feed — with drill-throughs into symbols, events, and users.

## Layout — D2 (toggleable drawer)

Full-page under the existing app chrome. Stacked full-width sections; activity feed lives in an overlay drawer.

- **Header:** title (`◆ ADMIN CONSOLE`) · LIVE dot + "updated Xs ago" · `◆ ACTIVITY` toggle button
- **Section 1 — Signal quality**
- **Section 2 — Pipeline health**
- **Section 3 — Business**
- **Activity drawer** — slides in from the right when toggled on. Sections stay full-width underneath (page content is not resized). Drawer open/closed state persists in `localStorage` under key `admin.activityDrawer`.

Terminal visual language: monospace, LED status dots, subtle borders, small-caps labels. Matches the existing `/dashboard` (`ActionableDashboard.tsx`) style.

---

## Data sources

Three:

| Source | Used for |
|---|---|
| **ClickHouse** (`scan_snapshots`, `scan_rows`, `bars`) | Signal quality, CH row counts, scan history, star transitions |
| **Postgres** (`User`, `Session`) | Users total, recent signups, role distribution, user drill-through |
| **In-memory instrumentation** (new — `src/lib/data/metrics.ts`) | Alpaca fetch success/error rolling window, scan p95, error event ring buffer |

Two new API routes, both ADMIN-gated (via existing middleware + explicit session check inside the route):

- `GET /api/admin/summary` — returns everything the page needs in one payload (all three sections). Server-side cached for 10s to protect CH from multi-tab hammering.
- `GET /api/admin/activity?limit=50` — returns feed events. Only polled while the drawer is open.

Both routes return `403` if `session.user.role !== "ADMIN"`.

---

## Sections — content and queries

### Section 1: Signal quality

Reads from CH `scan_rows`, latest snapshot.

- **Role split:** `SELECT role, count() FROM scan_rows WHERE generated_at = (SELECT max(generated_at) FROM scan_rows) GROUP BY role`. Display: `16 primary · 59 secondary · 525 none` with a small horizontal stacked bar.
- **pUp histogram:** primary rows only, `SELECT round(p_up, 2) AS bucket, count() FROM scan_rows WHERE generated_at = (SELECT max(...)) AND role = 'primary' GROUP BY bucket ORDER BY bucket`. Rendered as inline vertical bars (~14 buckets).
- **Top-5 stars:** `SELECT symbol, role, net, p_up FROM scan_rows WHERE decision = 'BUY' AND star = 1 AND generated_at = (SELECT max(...)) ORDER BY net DESC LIMIT 5`. Table with `★` icon per row.
- **Primary-count sparkline (1h):** `SELECT generated_at, countIf(role = 'primary') FROM scan_rows WHERE generated_at >= now() - INTERVAL 1 HOUR GROUP BY generated_at ORDER BY generated_at`. Small SVG polyline.

### Section 2: Pipeline health

Mixed sources:

- **Alpaca fetch success (1h):** `metrics.getAlpacaSuccessRate()` — rolling ratio of successful `pullBars` calls over failed ones in the last hour.
- **Fundamentals cache hit rate:** fetched from the fundamentals sidecar. If `/health` doesn't already expose this, add `/stats` returning `{ cache_size, hit_count, miss_count }` and compute the ratio in the client. See "Deferred / flag" below.
- **CH row counts:** `SELECT count() FROM bars WHERE ts >= now() - INTERVAL 24 HOUR` and same for `scan_rows`. Two numbers.
- **Scan p95 latency:** `metrics.getScanLatencyP95()` — rolling p95 of the last 60 `buildLiveSnapshot` durations.

### Section 3: Business

Reads from postgres:

- **Users by role:** `SELECT role, count(*) FROM "User" GROUP BY role`. Display: `247 total · 231 free · 15 premium · 1 admin`.
- **Signups last 7d:** `count(*) WHERE createdAt >= now() - INTERVAL '7 days'`.
- **Recent 5 signups:** `SELECT createdAt, email, role FROM "User" ORDER BY createdAt DESC LIMIT 5`. Clickable rows → `/admin/users/[id]`.
- **MRR (stub):** `count(role='PREMIUM') * 19` with a caption `stripe not wired`. Full metric ships when Stripe lands.
- **Churn:** **not in v1.** No data source until Stripe subscription events exist.

### Activity drawer

Chronological feed, mixed sources, most-recent-first.

Event types:

| Type | Source | Text |
|---|---|---|
| `scan` | `scan_snapshots` (all rows in window) | `scan · 600 sym · 16 primary · 5 stars` |
| `star` | derived: diff `star=1` symbol sets between consecutive snapshots | `star · RY entered top-5` / `star · SCHW dropped` |
| `signup` | `User.createdAt` in window | `signup · nick@… (free)` |
| `alpaca` | `metrics.getErrors()` filtered by kind | `alpaca · rate-limit · retried ok` |
| `ch` | `metrics.getErrors()` filtered by kind | `ch · insert failed · queryBarsMulti timeout` |
| `pay` | (stub — omitted from v1 until Stripe) | — |

Feed window: last 4 hours or 100 events, whichever is smaller.

---

## Drill interactions

Three drill paths, none of them leave the admin page (except the user drill).

### Symbol drill — right-side drawer

Click a symbol in the top-5 stars table → symbol drawer opens (replaces the activity drawer if open). Content:

- Header: symbol, current price, current role, current decision
- Last 20 scans: `SELECT generated_at, net, role, decision, star FROM scan_rows WHERE symbol = ? ORDER BY generated_at DESC LIMIT 20`
- Net-over-1h sparkline
- "Close" button restores whatever drawer was previously open

### Activity event → inline expand

Click an event row in the activity drawer → row expands in place. Behaviour by type:

- `scan` — expand shows that scan's top-5 stars (same query as Section 1 but scoped to the clicked `generated_at`).
- `signup` — expand shows email, role, and a link to the user drill.
- `alpaca` / `ch` — expand shows the error message + stack (from `metrics.getErrorDetail(id)`).
- `star` — expand shows the symbol's last-scan card (link into the symbol drill).

Only one event expanded at a time.

### User drill — `/admin/users/[id]` (new page)

Click a signup row in Business → navigate to `/admin/users/[id]` (new route, ADMIN-gated).

Content:
- User info: email, username, name, role, createdAt, image
- Portfolio positions (from existing `PortfolioEntry` table)
- Watchlist (from existing `WatchlistEntry` table)
- Actions:
  - Role override: dropdown `USER | PREMIUM | ADMIN` → `POST /api/admin/users/[id]/role` with body `{ role }`
  - Suspend: toggle → `POST /api/admin/users/[id]/suspend` with body `{ suspended: boolean }`

Requires a schema migration: add `suspended Boolean @default(false)` to `User`. The middleware and session logic don't need to change in v1 — suspend is a flag admins can toggle; enforcing it (blocking login) is a follow-up.

---

## Refresh

Client polling every 12 seconds. Simple `useEffect` + `setInterval` pattern:

- `useSummaryPolling()` — fires `GET /api/admin/summary` every 12s while page mounted; sets state.
- `useActivityPolling(enabled)` — fires `GET /api/admin/activity?limit=50` every 12s only when the activity drawer is open.

Header displays "updated Xs ago" via a `useAge()` hook that ticks once per second.

Server-side cache: the `summary` route uses a module-scope `{ payload, ts }` singleton with a 10-second TTL. Multi-tab admins hitting it in the same window get one cached response — no repeated CH hits.

---

## Instrumentation module — `src/lib/data/metrics.ts` (new)

Small in-process ring buffers. No new dependencies.

```ts
// Alpaca fetch outcomes — recorded from src/lib/data/bars.ts:pullBars
export function recordAlpacaFetch(ok: boolean): void;
export function getAlpacaSuccessRate(windowMs = 3_600_000): number;

// Scan durations — recorded from src/lib/engine/scanner.ts:buildLiveSnapshot
export function recordScanDuration(ms: number): void;
export function getScanLatencyP95(sampleN = 60): number;

// Errors — recorded from bars.ts, clickhouse.ts, fundamentals-client.ts
export interface MetricsError {
  id: string;         // uuid for the drill lookup
  kind: "alpaca" | "ch" | "fundamentals";
  message: string;
  stack?: string;
  ts: number;
}
export function recordError(e: Omit<MetricsError, "id" | "ts">): void;
export function getErrors(limit = 50): MetricsError[];
export function getErrorDetail(id: string): MetricsError | null;
```

Ring buffer sizes: 500 Alpaca outcomes, 200 scan durations, 200 errors. Older entries dropped on push.

---

## Files

**New:**
- `src/app/admin/page.tsx` — replaced content (client component; uses the polling hooks)
- `src/app/admin/AdminDashboard.tsx` — main dashboard component (composition of sections + drawer)
- `src/app/admin/sections/SignalQualitySection.tsx`
- `src/app/admin/sections/PipelineHealthSection.tsx`
- `src/app/admin/sections/BusinessSection.tsx`
- `src/app/admin/ActivityDrawer.tsx`
- `src/app/admin/SymbolDrillDrawer.tsx`
- `src/app/admin/hooks/useSummaryPolling.ts`
- `src/app/admin/hooks/useActivityPolling.ts`
- `src/app/admin/hooks/useAge.ts`
- `src/app/admin/users/[id]/page.tsx` — new user drill route
- `src/app/api/admin/summary/route.ts`
- `src/app/api/admin/activity/route.ts`
- `src/app/api/admin/users/[id]/route.ts` — GET user detail
- `src/app/api/admin/users/[id]/role/route.ts` — POST role override
- `src/app/api/admin/users/[id]/suspend/route.ts` — POST suspend toggle
- `src/lib/data/metrics.ts` — instrumentation module
- `prisma/migrations/<ts>_add_user_suspended/migration.sql` — adds `suspended` column

**Modified:**
- `src/lib/data/bars.ts` — call `recordAlpacaFetch(ok)` around `pullBars`
- `src/lib/engine/scanner.ts` — wrap `buildLiveSnapshot` in a duration timer, call `recordScanDuration`
- `src/lib/data/clickhouse.ts` — call `recordError({ kind: "ch", ... })` in each catch block instead of the current `console.warn`. Keep the `console.warn` as well for terminal visibility.
- `src/lib/ml/fundamentals-client.ts` — same treatment for CH errors
- `prisma/schema.prisma` — add `suspended Boolean @default(false)` on `User`

---

## Deferred / flag for follow-up

- **MRR & churn:** stubbed until Stripe wiring exists. MRR shows `count(PREMIUM) × $19` with a "stripe not wired" caption. Churn omitted.
- **Fundamentals sidecar `/stats` endpoint:** if the existing `/health` endpoint doesn't already expose `hit_count` / `miss_count`, add a `/stats` endpoint on the sidecar. If that's out of scope for this iteration, display "cache: n/a" in Section 2 and open a follow-up.
- **Suspend enforcement:** the v1 suspend action just sets the flag. Enforcing it at login/session validation is a follow-up (small — auth middleware check).
- **`scan_rows` retention:** at 15s scan intervals × 600 symbols = ~2.4M rows/day. Was already noted as a follow-up from the CH audit. Not part of admin dashboard work, but the dashboard makes the growth rate visible so worth adding a `TTL` clause to `scan_rows` (`TTL generated_at + INTERVAL 90 DAY DELETE`) alongside this work if we want to avoid unbounded growth.

---

## Non-goals

- Real-time push (SSE) for the admin dashboard — polling is sufficient. Existing `/api/scan/stream` is not extended for admin use.
- Editing signal/gate parameters from the dashboard (calibration, `primaryBand`, etc.) — read-only.
- Admin action audit log — not in v1.
- CH direct query interface — not a "raw SQL" panel; the queries are hardcoded per section.
