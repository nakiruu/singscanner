# Shadow monitor (sub-project A')

**Date:** 2026-07-07
**Status:** Approved

## Goal

Run a challenger gate configuration alongside the baseline scanner on every scan cycle, log per-symbol divergences to a persistent ledger, resolve them after the true horizon has elapsed, and compute a Beta-shrinkage posterior that reports whether the challenger would have produced better realized after-cost value than the baseline. Never auto-switches — surfaces evidence for humans. Ships **before** the auto-trader so we have empirical support for gate tweaks before real (paper) money moves.

The challenger is a full port of `singscannerauto3/dynamic_challenger.py` — the §64 dynamic action-value surface: bucket-conditioned action value with shrinkage toward a static fallback and a within-bucket ridge adjustment on 8 context features.

## Scope boundary

**In scope:**
- One `ShadowMonitor` per horizon (3d/5d/10d), running in-process from the scanner's existing per-cycle hook.
- Full port of `DynamicActionValueChallenger` including 8-feature ridge fit + shrinkage + decay.
- Persistent ledger in ClickHouse (survives restarts).
- Beta-shrinkage posterior with `κ₀=7, δ₀=0` and promotion criteria `n_live ≥ 30 AND positive_share_live ≥ 0.55 AND δ_post_live > 0`.
- Resolution horizons matching the scan horizon (3d/5d/10d trading days) with forward-price lookup from the `bars` table.
- Historical backlog: replay the last 200 trading days of scans against historical daily bars to seed the challenger buckets. Tagged `source='historical'`; live rows tagged `source='live'`. Posterior promotion counts live-only.
- Admin dashboard basic Shadow section on `/admin`.
- Dedicated detailed page at `/admin/shadow` (ADMIN-gated).

**Out of scope:**
- Auto-promotion. §53 explicit: `automatic_surface_switching = disabled`. Report `promotable: bool` only.
- Multi-challenger comparison. One dynamic challenger per horizon.
- Cross-horizon posterior aggregation.
- Scheduled backlog re-runs. Admin triggers manually if needed.
- Live-only feature fidelity in backlog. Replay uses conservative defaults for fundamentals cache, intraday vol, quote freshness. `source='historical'` is explicitly biased; excluded from promotion.
- Non-scanner shadow evaluations (e.g. shadowing the trader's execution).

## Design

### 1. Architecture

Three shadow monitors, one per horizon. Each hooked into the scanner via a fire-and-forget async call from `getLatestSnapshot` right after `persistSnapshotAsync`:

```
Scanner.getLatestSnapshot(horizon)
      │
      └── refresh(horizon).then((snap) => {
            ...
            persistSnapshotAsync(snap);       // existing
            shadowMonitorAsync(snap);         // NEW
            return snap;
          })
```

Per-horizon monitor:

```
ShadowMonitor(horizon)
  ├── DynamicActionValueChallenger      ← per-horizon in-memory + CH-persisted
  ├── observe(snapshot):
  │     ├── for each row: predict challenger edge, derive challenger decision
  │     ├── log divergences to shadow_pending
  │     └── run resolvePending() opportunistically
  ├── resolvePending():
  │     ├── age-check every pending row
  │     ├── forward-price lookup from `bars` for expired rows
  │     ├── compute δ, insert into shadow_resolved
  │     └── challenger.update({ bucket, features, realized_value_bps })
  └── flushBuckets(): snapshot in-memory bucket state to shadow_buckets
```

Bootstrap (`bootstrapShadowMonitors()`) instantiates all three at server start via `src/instrumentation.ts` (same hook the auto-trader will use). If ClickHouse is unavailable, monitors log a warning and no-op — the scanner's core path is not affected.

Historical backlog runs once at first boot per horizon (idempotent — checks whether `shadow_resolved` has any `source='historical'` rows for that horizon; skips if yes). Admin endpoint can force re-seed by clearing `source='historical'` rows and re-running.

### 2. Divergence detection

Ported from `shadow_monitor.py:observe()`.

For each scan row in a snapshot:
1. Compute the challenger's edge estimate: `(challengerEdge, diag) = challenger.predict(row, fallback=row.modelEdge, tickerEdge=lookup)`.
2. Compute the challenger's net: `challengerNet = row.net + (challengerEdge − row.modelEdge)`.
3. Re-derive the challenger's decision from `challengerNet` using the same rules as the baseline:
   - `role='none' AND !isHeld` → `HOLD-CASH`
   - `isHeld=true` → keep `row.decision` (held-side divergence is a v2 problem)
   - `challengerNet > 0` → `BUY`
   - else → `WAIT`
4. Divergence if `row.decision !== challengerDecision` OR `|challengerNet − row.net| > 20 bps`.
5. Dedup: skip if `(symbol, row.decision, challengerDecision)` already exists as an unresolved row in `shadow_pending`. A divergence that persists across N scans is ONE piece of evidence.
6. Insert into `shadow_pending` with `source='live'`, `bucket=<challenger's bucket key>`, `features=<8-vec>`, `entry_price=row.price`, submitted_at=now.

### 3. Resolution

For each pending row:
1. Compute `age = now − submitted_at`.
2. Look up the horizon's resolution window:
   - 3d → 3 trading days worth of ms
   - 5d → 5 trading days
   - 10d → 10 trading days
3. If `age < window`: leave pending.
4. If `age ≥ window`: resolve.

Resolution algorithm:
1. Query `bars` for the earliest daily bar strictly after `submitted_at` for this symbol.
2. If no bar found AND `age < 4 × window`: leave pending (waiting for market to open). Otherwise drop the row (no data — mark clean=0 and archive to `shadow_resolved` for audit).
3. `forward_price = bar.close`.
4. `realized_bps = (forward_price / entry_price − 1) × 10000`.
5. Value function (symmetric cash framing, per `shadow_monitor.py:282-286`):
   - `value(BUY) = realized_bps`
   - `value(anything else) = −realized_bps`
6. `δ = value(challengerDecision) − value(baselineDecision)`.
7. Insert into `shadow_resolved` with `clean=1`.
8. Call `challenger.update({ bucket, features, realized_value_bps: value(challengerDecision) })`.
9. Delete the pending row.

### 4. Data model — 3 ClickHouse tables

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
  bucket               LowCardinality(String),   -- e.g. 'primary|regular'
  features             Array(Float32),           -- length 8, fixed FEATURE_NAMES order
  source               LowCardinality(String)    -- 'live' | 'historical'
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
  source               LowCardinality(String),   -- 'live' | 'historical'
  clean                UInt8                     -- 1 = counted toward posterior, 0 = dropped
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(resolved_at)
ORDER BY (resolved_at, horizon, symbol);

CREATE TABLE IF NOT EXISTS shadow_buckets (
  horizon      LowCardinality(String),
  bucket       LowCardinality(String),         -- '{role}|{session}'
  updated_at   DateTime64(3, 'UTC'),
  n            UInt32,
  mean_y       Float32,
  mean_x       Array(Float32),                 -- length 8
  xtx          Array(Float32),                 -- length 64, row-major 8x8
  xty          Array(Float32)                  -- length 8
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (horizon, bucket);
```

`shadow_buckets` uses `ReplacingMergeTree` keyed by `(horizon, bucket)` with `updated_at` as the version column so the latest state wins after merges. Bucket state is loaded into memory on monitor construction and flushed to CH on a debounced timer (default: 30s after any update, or immediately on graceful shutdown).

### 5. Beta-shrinkage posterior

Pure function, no state.

```ts
export interface PosteriorInput {
  rows: Array<{ delta_bps: number }>;
  kappa0?: number;    // default 7
  delta0?: number;    // default 0
}

export interface Posterior {
  n_clean: number;
  positive_share: number;
  mean_delta_bps: number;
  delta_post_bps: number;
  promotable: boolean;
  reason: string;
}

export function computePosterior(input: PosteriorInput): Posterior;
```

Formula:
```
n            = rows.length
mean_δ       = mean(delta_bps)
positive_share = count(delta_bps > 0) / n
δ_post       = (κ₀ · δ₀ + n · mean_δ) / (κ₀ + n)
promotable   = n ≥ 30 AND positive_share ≥ 0.55 AND δ_post > 0
```

Two posteriors are computed and surfaced side-by-side:
- **`live`** — over `source='live' AND clean=1` rows. Promotion criterion evaluates this one.
- **`all`** — over all `clean=1` rows (live + historical). Dashboard visibility only. Marked biased.

### 6. Dynamic action-value challenger (`DynamicActionValueChallenger`)

Port of `dynamic_challenger.py`. Preserves exact numeric behavior: same feature layout, same κ, same λ, same solver.

**Constants:**
```ts
const FEATURE_NAMES = [
  "role_primary", "role_secondary", "role_retained",
  "current_weight", "delta_weight", "cash_fraction",
  "has_open_order", "ticker_edge",
] as const;
const N_FEATURES = 8;
const PRIOR_STRENGTH_KAPPA = 20.0;
const RIDGE_LAMBDA = 5.0;
const MIN_SAMPLES_FOR_RIDGE = 8;
const MAX_SAMPLES_PER_BUCKET = 500;
const DECAY_FACTOR = 0.9;
```

**Bucket key:** `` `${role}|${session}` `` where `session ∈ {regular, premarket, afterhours, closed}`.

**Feature vector construction** — ported from `_extract_features`:
```ts
function extractFeatures(row: ScanRow, ctx: { cashFraction: number; tickerEdge: number }): number[] {
  const heldNotional = 0;   // v1: no held-side integration yet
  const notional = row.price * 20;   // "rough approximation" per source
  const currentWeight = heldNotional / Math.max(notional * 20, 1);
  const deltaWeight = (notional - heldNotional) / Math.max(notional * 20, 1);
  return [
    row.role === "primary" ? 1 : 0,
    row.role === "secondary" ? 1 : 0,
    row.role === "retained" ? 1 : 0,
    currentWeight,
    deltaWeight,
    ctx.cashFraction,
    0,                    // has_open_order — v1: always 0 (trader ships later)
    ctx.tickerEdge,
  ];
}
```

**Prediction (`predict(row, fallbackBps, tickerEdge)`):**
- Look up bucket by key.
- If bucket is missing or `n < 3`: return `fallbackBps` with `shrinkage=0`.
- Otherwise: compute ridge β if `n ≥ MIN_SAMPLES_FOR_RIDGE` else β=0.
- `ridge_adj = Σᵢ (xᵢ − mean_xᵢ) × βᵢ`
- `w = n / (n + κ)`
- `estimate = (1 − w) × fallback + w × (mean_y + ridge_adj)`
- Clamp to `[0, 600]` bps.
- Return `(estimate, diagnostics)` where diagnostics = `{ bucket, n, shrinkage_strength: w, fallback_bps, bucket_mean: mean_y, ridge_adj }`.

**Update (`update(resolvedRow)`):**
- If `bucket.n ≥ MAX_SAMPLES_PER_BUCKET`: multiply `n`, `xty`, `xtx` by `DECAY_FACTOR`. Preserves ridge geometry while making room.
- Incremental update:
  ```
  n' = n + 1
  mean_y' = ((n · mean_y) + realized) / n'
  mean_x_i' = ((n · mean_x_i) + x_i) / n'
  xty_i' = xty_i + x_i · realized
  xtx_ij' = xtx_ij + x_i · x_j
  n = n'
  ```

**Ridge solve (`ridgeBeta(bucket)`):**
- `A = xtx + λ·I` (8×8)
- `b = xty` (8)
- Solve `A β = b` via Gauss-Jordan with pivot check. Return `null` if any pivot has `|piv| < 1e-9`.
- 8×8 is trivial — inlined.

**Persistence:** `challenger.load(horizon)` reads latest row per bucket from `shadow_buckets`. `challenger.flush(horizon)` upserts each bucket. Flush is debounced (30s after update, immediately on shutdown).

**v1 feature-vector limitations (documented, not blockers):**
- `has_open_order` is always 0 in v1 — the trader ships later. The ridge sees this as a constant column with no variance; its coefficient will be dampened by the ridge penalty.
- `ticker_edge` is always 0 in v1 — trader-supplied slippage history doesn't exist yet. Same low-variance behavior.
- `current_weight` and `delta_weight` treat `heldNotional=0` for all BUY-side rows. Meaningful variance only appears once the trader integrates and passes its held-position map into the shadow monitor's `observe()` call.

The effective feature set in v1 is roughly `[role_primary, role_secondary, role_retained, cash_fraction]`. The bucket + shrinkage machinery still works; the ridge geometry just has fewer degrees of freedom. Sub-project A (auto-trader) unlocks the remaining features by providing held positions, open orders, and per-ticker slippage.

### 7. Historical backlog

Idempotent one-time job per horizon.

**Trigger:** at server boot, `bootstrapShadowMonitors()` checks `SELECT count() FROM shadow_resolved WHERE horizon={h} AND source='historical'`. If 0 → schedule backlog. If >0 → skip.

**Admin re-seed:** `POST /api/admin/shadow/backlog { horizon, force: true }` deletes existing `source='historical'` rows (both pending and resolved) for that horizon and reruns.

**Algorithm:**
1. Determine day set: last `HISTORICAL_LOOKBACK_DAYS=200` trading days, ending yesterday.
2. For each day D (oldest first):
   - Query `bars` for `ts` in `[D − 260 trading days, D]` for the entire universe (bulk fetch).
   - Recompute the scan pipeline for day D using ONLY daily-bar-derivable inputs. Missing live inputs use conservative constants:
     - `vol_pct_per_bar` → default 0.012 (~1.2%/bar)
     - `hasFundamentals` → false; all fundamentals fields `null`
     - `quoteAgeSec` → 0 (assume fresh)
     - `spreadBps` → 8 (default cost)
     - `marketOpen` → true (assume regular session)
   - Run the standard scanner functions: `computeFamilies`, `forecast`, `assignRoles`, `gateDecision` → baseline rows.
   - For each row: `challengerEdge = challenger.predict(row, row.modelEdge, tickerEdge=0)` and derive challenger decision.
   - For each divergence: compute the forward price directly from `bars` at `D + horizon_trading_days`. If beyond available data (recent days) skip that row.
   - `realized_bps`, `value`, `δ` — same as live resolution.
   - Insert directly into `shadow_resolved` with `source='historical'`, `clean=1`. Never touches `shadow_pending`.
   - Call `challenger.update` with `realized_value_bps = value(challengerDecision)`.
3. Every 20 days: flush `challenger` to `shadow_buckets`.
4. Report progress in admin: `{ horizon, days_processed, days_total, samples_added }`.

**Guardrails:**
- If daily-bar coverage is <100 days: skip backlog, log warning "insufficient history".
- Sequential per horizon to avoid CH thrashing.
- Backlog scan reuses the same production functions from `src/lib/engine/*.ts` — no reimplementation.

### 8. Admin dashboard integration

**Basic view — new `<ShadowSection />` between Signal Quality and Pipeline Health on `/admin`:**

```
▸ Shadow monitor · challenger vs baseline                    [ open → ]
┌─────────────────────────────────────────────────────────────┐
│  horizon   δ_post (live)   n(live)   pos%    status         │
│    3d      +12.4 bps        47        61%    promotable ●    │
│    5d      −3.1 bps         38        48%    hold ○          │
│   10d      +1.8 bps         22        55%    n<30 ○          │
│                                                              │
│  historical: 587 samples · δ_post +8.2 bps (biased)          │
└─────────────────────────────────────────────────────────────┘
```

Reads `/api/admin/shadow/summary`. `[ open → ]` navigates to `/admin/shadow`.

**Detailed view — new route `/admin/shadow`:**
- Header: baseline config snapshot (edgePrimary, frictionPrimary, primaryBand). Copy of the current calibration output.
- Per-horizon tabs (3d / 5d / 10d):
  - **Posterior card:** live + all posteriors side-by-side (n, mean_δ, positive_share, δ_post, promotable, reason).
  - **Bucket grid:** role × session matrix showing `n, mean_y_bps` per cell.
  - **Recent pending:** last 20 rows from `shadow_pending`. Columns: symbol, baseline_decision, challenger_decision, baseline_net, challenger_net, age.
  - **Recent resolved:** last 20 rows from `shadow_resolved` with `source='live'`. Columns: symbol, δ, realized, resolved_at.
  - **Historical δ chart:** SVG polyline of per-day mean δ over the historical backlog.
- Backlog controls: status + "Re-run backlog" button (POST to `/api/admin/shadow/backlog`).

### 9. API routes

All ADMIN-gated via explicit `auth()` check (matches existing admin pattern):

- **`GET /api/admin/shadow/summary`** — basic view payload:
  ```ts
  interface ShadowSummary {
    generatedAt: string;
    perHorizon: Array<{
      horizon: "3d"|"5d"|"10d";
      posterior_live: Posterior;
      posterior_all: Posterior;
      backlogStatus: "not-started" | "running" | "done";
      pendingCount: number;
    }>;
  }
  ```
- **`GET /api/admin/shadow/[horizon]`** — detailed view payload:
  ```ts
  interface ShadowDetail {
    horizon: "3d"|"5d"|"10d";
    posterior_live: Posterior;
    posterior_all: Posterior;
    buckets: Array<{ bucket: string; n: number; mean_y_bps: number }>;
    pending: Array<{ symbol; baselineDecision; challengerDecision; baselineNetBps; challengerNetBps; ageSec }>;
    resolved: Array<{ symbol; delta_bps; realized_bps; resolvedAt }>;
    historicalDailyDelta: Array<{ day: string; mean_delta_bps: number; n: number }>;
  }
  ```
- **`POST /api/admin/shadow/backlog`** — body `{ horizon: "3d"|"5d"|"10d"; force?: boolean }`. Triggers re-seed. Returns `{ scheduled: true }`.

Server-side cache 10s on `summary`; no cache on `[horizon]` (details view is heavier but not polled).

### 10. Files

**Create:**
- `src/lib/shadow/monitor.ts` — `ShadowMonitor` class per horizon; `observe(snapshot)`, `resolvePending()`.
- `src/lib/shadow/dynamic-challenger.ts` — port of `DynamicActionValueChallenger`.
- `src/lib/shadow/features.ts` — `extractFeatures`, `sessionBucketNow`, `bucketKey`.
- `src/lib/shadow/posterior.ts` — `computePosterior`.
- `src/lib/shadow/backlog.ts` — `runHistoricalBacklog(horizon)`.
- `src/lib/shadow/persistence.ts` — CH read/write helpers for pending/resolved/buckets.
- `src/lib/shadow/index.ts` — `bootstrapShadowMonitors()`, public API.
- `services/clickhouse/init/03_shadow_schema.sql` — the 3 tables.
- `src/app/api/admin/shadow/summary/route.ts`
- `src/app/api/admin/shadow/[horizon]/route.ts`
- `src/app/api/admin/shadow/backlog/route.ts`
- `src/app/admin/shadow/page.tsx` — server component that renders the client.
- `src/app/admin/shadow/ShadowClient.tsx` — client component for detailed view with tabs + charts.
- `src/app/admin/sections/ShadowSection.tsx` — basic-view card for `/admin`.

**Modify:**
- `src/lib/engine/scanner.ts` — inside `getLatestSnapshot`'s `.then((snap) => {...})`, add `shadowMonitorAsync(snap)` fire-and-forget after the existing `persistSnapshotAsync(snap)`.
- `src/instrumentation.ts` — call `bootstrapShadowMonitors()` in `register()`.
- `src/app/admin/AdminDashboard.tsx` — mount `<ShadowSection />` between `<SignalQualitySection />` and `<PipelineHealthSection />`.

### 11. Configuration — env vars

```
SHADOW_ENABLED=true
SHADOW_HISTORICAL_LOOKBACK_DAYS=200
SHADOW_MIN_HISTORY_DAYS=100                  # skip backlog if bars coverage below this
SHADOW_BUCKET_FLUSH_DEBOUNCE_MS=30000        # in-memory bucket flush cadence
SHADOW_KAPPA0=7                              # posterior prior strength
SHADOW_DELTA0=0                              # posterior prior mean
SHADOW_MIN_CLEAN_ROWS=30
SHADOW_MIN_POSITIVE_SHARE=0.55
SHADOW_MIN_POSTERIOR_DELTA_BPS=0
```

Defaults ported verbatim from `shadow_monitor.py`. Changes require server restart.

### 12. Failure modes

| Failure | Behaviour |
|---|---|
| CH unavailable at boot | Monitors log warning, no-op. Scanner core path unaffected. |
| CH write fails during observe | Log via `metrics.recordError({ kind: "ch" })`, drop the pending row (no re-queue). |
| Scan snapshot missing when observe runs | Skip cycle (nothing to compare). |
| Ridge solve pivot fails | Return `ridge_adj=0`; bucket_mean is still used. |
| Bar coverage <100 days | Skip historical backlog for that horizon, log warning. |
| Bucket state corrupted (NaN in xtx/xty) | Detect on load, reset bucket to `n=0`. Log warning. |
| Historical backlog fails mid-run | Idempotent — next boot resumes from the last processed day (`shadow_resolved` count check gets refined by max resolved_at date). |

### 13. Observability

- Every observe cycle → `metrics.recordShadowCycle(horizon, durationMs, divergences, resolved, errors)`.
- Metrics exposed via existing admin dashboard Pipeline Health section as additional stat tiles.
- Backlog progress via `/api/admin/shadow/summary`.

### 14. Non-goals

- Auto-switching baseline → challenger (§53). Report only.
- Multi-challenger comparison — one dynamic challenger per horizon.
- Cross-horizon posterior aggregation — each horizon scored independently.
- Held-side divergence detection — v1 keeps `baselineDecision` for `isHeld=true` rows. Sell-side challenging is a v2 problem.
- Backlog fidelity for live-only features — historical replay uses conservative defaults; `source='historical'` `δ_post` is biased and excluded from promotion.
- Non-scanner shadowing (e.g., shadowing the trader's execution) — future work.
- Real-time notification of divergences — dashboard poll cadence (12s) is sufficient.
