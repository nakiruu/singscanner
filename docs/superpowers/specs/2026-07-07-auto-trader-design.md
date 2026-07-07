# Auto-trader (sub-project A)

**Date:** 2026-07-07
**Status:** Approved

## Goal

Convert the scanner's per-horizon decisions into real orders on three Alpaca **paper** accounts (one per horizon: 3d / 5d / 10d). The trader inherits the scanner's brain — role assignment, gate, sell.ts decisions, stop/target levels — and adds a broker adapter, per-horizon runners, risk-based sizing, and an event stream that later sub-projects (B: dashboard UI, C: notifications) consume.

## Scope boundary

**In scope:**
- Broker adapter for the Alpaca paper endpoint (safety-guarded to refuse non-paper URLs).
- Three per-horizon runner loops, each pinned to a paper account via env vars.
- Bar-close cadence (5-min boundaries in US/Eastern), covering pre-market, regular, and after-hours sessions.
- Full port of auto3's sell/re-attach/buy/rotate cycle including extended-hours handling.
- Risk-based sizing formula ported from auto3.
- Whole-share orders only.
- New ClickHouse tables for order history and position events.
- Public read/event interfaces that sub-projects B and C plug into without rework.

**Out of scope (deferred to their own specs):**
- Dashboard UI showing holdings/orders (sub-project B).
- Notification service and user prefs (sub-project C — will use Novu).
- Fractional shares — not in v1.
- 21d horizon — infrastructure is horizon-agnostic so 21d slots in cleanly later.
- Real (non-paper) trading. The broker adapter refuses non-paper URLs at construction time.

## Design

### 1. Architecture

Three runners live inside the Next.js server process (same pattern as the scanner singleton). Each runner is pinned to one paper Alpaca account via env vars. Missing env vars = runner silently disabled.

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js server process                    │
│                                                              │
│   Scanner singleton  ──►  ScanSnapshot cache (per horizon)   │
│                                    │                          │
│                                    ▼                          │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│   │ 3d runner    │    │ 5d runner    │    │ 10d runner   │  │
│   │  ↕ Broker    │    │  ↕ Broker    │    │  ↕ Broker    │  │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│          │                    │                    │          │
│          └────────────────────┼────────────────────┘          │
│                               ▼                                │
│               CH: trader_orders + trader_position_events       │
└─────────────────────────────────────────────────────────────┘
                               ▼
                     (sub-project C polls events)
                     (sub-project B reads holdings via API)
```

### 2. Cadence and state machine

**Cadence:** Each runner wakes on 5-minute bar-close boundaries in US/Eastern (`:00, :05, :10, ...`) between 04:00 and 20:00 ET. Weekends skipped. Uses `setTimeout` computed off the next bar boundary — no cron dep.

**Per-cycle steps (order-critical):**

1. `syncAccount()` — fetch equity, buying_power, cash.
2. `syncPositions()` — fetch current paper positions into a `Map<symbol, PositionState>`.
3. `syncOpenOrders()` — build a `Set<symbol>` of open sell brackets.
4. `reconcileFills()` — diff current positions vs the previous cycle's map:
   - New symbol → emit `entry` event.
   - Missing symbol → emit `exit` event with realized PnL (best-effort from fill price).
   - Qty change on an existing position (e.g. bracket partial fill, rotation add-on) → emit `entry` event with the delta qty. There is no distinct `qty-change` kind; net qty movement is what consumers care about.
5. **SELLS** on held positions:
   - **Regular hours:** the bracket legs own stop/target. Runner closes at market only when `scanRow.decision === "SELL"` AND `scanRow.reason` matches `reversed | deteriorated | stop loss | target reached`.
   - **Extended hours:** compute widened levels — `ext_stop = stop × (1 − TRADER_EXT_STOP_WIDEN)`, `ext_target = target × (1 + TRADER_EXT_TARGET_WIDEN)`. Trigger a marketable limit sell if `signal_exit | stop_hit | target_hit`. Limit price = `current_price × (1 − TRADER_EXT_LIMIT_SLIP)`. Skip if position qty < 1 (extended session rejects fractional).
   - Track `closing[symbol] = Date.now()` after any close attempt; skip re-closing if `now - closing[symbol] < 600_000` (10 min).
6. **Re-attach missing exit legs (RTH only):** for each held position with no open sell bracket, submit fresh OCO with current `stopPx` / `stopLimitPx` / `takeProfitLimit`. If bracket sanitization fails (e.g., invalid levels), skip.
7. **BUYS:**
   - Session gates: no entries during after-hours; premarket entries blocked before `TRADER_PREMARKET_MIN_HOUR` (default 07:00 ET).
   - Filter starred BUY rows in the horizon's snapshot that aren't already held.
   - Rank by `net`, take up to `TRADER_MAX_ENTRIES_PER_CYCLE` (default 2).
   - Respect `TRADER_MAX_POSITIONS` (default 8) total open positions.
   - For each, compute `sizePosition(...)` (see §5), submit bracket order.
8. **ROTATIONS:** up to `TRADER_MAX_ROTATIONS_PER_CYCLE` (default 1) where a held position's `scanRow.bestRotation.netAdvantageBps > 0` AND position age ≥ `TRADER_ROTATION_MIN_AGE_S` (default 3600). Rotation = close outgoing at market, size incoming with `cashAvailable = freed cash - fees`.
9. `recordTraderCycle(horizon, durationMs, entries, exits, errors)` — feeds admin dashboard pipeline health.

**Stale-scan guard:** if the horizon's most recent snapshot is older than 5 minutes, skip the cycle. Trader must not act on stale state.

### 3. Broker adapter — `src/lib/trader/broker.ts`

Thin async HTTP wrapper. Typed request/response. All operations throw `BrokerError` on failure. Rate-limit backoff on `429` (exponential, 3 retries max).

```ts
export class BrokerError extends Error {
  constructor(message: string, public status?: number, public alpacaCode?: string) { super(message); }
}

export interface BrokerConfig {
  keyId: string;
  secret: string;
  baseUrl: string;   // must contain "paper" — enforced in constructor
}

export interface AccountSnapshot {
  equity: number;
  buyingPower: number;
  cash: number;
}

export interface PositionState {
  symbol: string;
  qty: number;
  avgPrice: number;
  marketValue: number;
  currentPrice: number;
  unrealizedPl: number;
  unrealizedPlPct: number;
}

export interface OpenOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: string;
  qty: number;
  limitPrice: number | null;
  stopPrice: number | null;
  submittedAt: string;   // ISO-8601 UTC
}

export interface BracketArgs {
  symbol: string;
  qty: number;
  entryLimit?: number;         // omit for market entry
  stopPrice: number;
  stopLimitPrice: number;
  takeProfitLimit: number;
  extended?: boolean;
}

export interface LimitArgs {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  limitPrice: number;
  extended?: boolean;
}

export class Broker {
  constructor(cfg: BrokerConfig);      // throws unless cfg.baseUrl.includes("paper")

  getAccount(): Promise<AccountSnapshot>;
  getPositions(): Promise<Map<string, PositionState>>;
  getOpenOrders(): Promise<OpenOrder[]>;
  submitBracket(args: BracketArgs): Promise<{ orderId: string }>;
  submitLimit(args: LimitArgs): Promise<{ orderId: string }>;
  cancelOrdersFor(symbol: string): Promise<void>;
  closePosition(symbol: string): Promise<{ orderId: string } | null>;
}
```

### 4. Sizing — `src/lib/trader/sizing.ts`

Pure function ported from `auto3/trader.py:495-518`.

```ts
export interface TraderSettings {
  riskPerTrade: number;      // fraction of equity risked if stop hits
  maxPositionPct: number;    // notional cap per position
  cashFloorPct: number;      // reserve
  minConviction: number;     // 1.0
  maxConviction: number;     // 2.0
}

export interface SizeInputs {
  equity: number;
  buyingPower: number;
  price: number;
  stop: number;
  conviction: number;        // in [minConviction, maxConviction]
  cashAvailable?: number;    // override for rotation flow
  settings: TraderSettings;
}

// Returns whole-share qty, floored to 0. Zero means "do not enter".
export function sizePosition(i: SizeInputs): number;
```

Formula:
```
risk_per_share = price − stop                            // must be positive
risk_budget    = equity × riskPerTrade × conviction
risk_qty       = risk_budget / risk_per_share
notional_qty   = (equity × maxPositionPct) / price
cash           = cashAvailable ?? buyingPower
cash_qty       = cash / price                             // 0 if cash ≤ 0
raw            = min(risk_qty, notional_qty, cash_qty)
qty            = floor(raw)                               // whole shares only
```

**Conviction mapping** (in the runner, not the sizer): starred BUY candidates in this cycle are ranked by `net` descending, then mapped linearly:

```
// N = candidate count in this cycle. rank ∈ [1, N].
conviction(rank) = maxConviction − (rank − 1) × (maxConviction − minConviction) / max(1, N − 1)
```

So rank 1 gets `maxConviction`, rank N gets `minConviction`, single-candidate cycles get `maxConviction`. Held-position rotations use `conviction = (minConviction + maxConviction) / 2`.

### 5. Runner — `src/lib/trader/runner.ts`

```ts
export interface RunnerConfig {
  horizon: "3d" | "5d" | "10d";
  broker: Broker;
  settings: TraderSettings;
  extendedSettings: ExtendedSessionSettings;
  sessionSettings: SessionSettings;
}

export class TraderRunner {
  constructor(cfg: RunnerConfig);
  start(): void;   // schedules the first tick at the next bar boundary
  stop(): void;    // cancels pending timer; does NOT cancel open Alpaca orders

  // State exposed for §7 (public interfaces)
  getAccountSnapshot(): AccountSnapshot;
  getHoldings(): PositionState[];
  getOpenOrders(): OpenOrder[];
  getLastCycleAt(): number | null;

  // Subscribe to position events for sub-project C
  onEvent(listener: (e: PositionEvent) => void): () => void;   // returns unsubscribe fn
}

export interface PositionEvent {
  horizon: "3d" | "5d" | "10d";
  ts: number;                         // ms epoch
  kind: "entry" | "exit" | "rotation";
  symbol: string;
  qty: number;
  fillPrice: number;
  reason: string;
  pnlBps: number | null;              // populated on exit
  positionPct: number;                // position value / equity at event time
}
```

### 6. Runners bootstrap — `src/lib/trader/index.ts`

```ts
// Called on server startup. Reads env vars, instantiates a Broker per horizon
// where env vars exist, wraps each in a TraderRunner, calls .start().
// Silent no-op if TRADER_ENABLED != "true".

export function bootstrapTraders(): void;
export function getRunner(horizon: "3d" | "5d" | "10d"): TraderRunner | null;
```

Env vars are read at bootstrap time only. Later changes require a server restart.

### 7. Data model

Two new ClickHouse tables. No new postgres tables (sub-project C will add user prefs later).

**`trader_orders`** — every order the runner submits.
```sql
CREATE TABLE IF NOT EXISTS trader_orders (
  id              UUID DEFAULT generateUUIDv4(),
  horizon         LowCardinality(String),
  submitted_at    DateTime64(3, 'UTC'),
  symbol          LowCardinality(String),
  side            LowCardinality(String),   -- 'buy' | 'sell'
  order_type      LowCardinality(String),   -- 'bracket' | 'limit' | 'market' | 'close'
  qty             Float32,
  limit_price     Nullable(Float32),
  stop_price      Nullable(Float32),
  target_price    Nullable(Float32),
  reason          String,
  alpaca_order_id String,
  status          LowCardinality(String)    -- 'submitted' | 'filled' | 'canceled' | 'error'
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(submitted_at)
ORDER BY (submitted_at, horizon, symbol);
```

**`trader_position_events`** — the notification-facing stream.
```sql
CREATE TABLE IF NOT EXISTS trader_position_events (
  id             UUID DEFAULT generateUUIDv4(),
  horizon        LowCardinality(String),
  ts             DateTime64(3, 'UTC'),
  event_kind     LowCardinality(String),    -- 'entry' | 'exit' | 'rotation'
  symbol         LowCardinality(String),
  qty            Float32,
  fill_price     Float32,
  reason         String,
  pnl_bps        Nullable(Float32),
  position_pct   Float32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (ts, horizon, symbol);
```

Both tables extend `services/clickhouse/init/01_schema.sql`.

### 8. Public interfaces for sub-projects B and C

All exposed from `src/lib/trader/index.ts`:

```ts
// Read-only holdings/orders view — sub-project B builds API routes on top.
export async function getHoldings(horizon: "3d" | "5d" | "10d"): Promise<Holding[]>;
export async function getOpenOrders(horizon: "3d" | "5d" | "10d"): Promise<OpenOrder[]>;
export async function getAccountSummary(horizon: "3d" | "5d" | "10d"): Promise<AccountSnapshot & { positionCount: number }>;

export interface Holding {
  symbol: string;
  qty: number;
  avgPrice: number;
  marketValue: number;
  currentPrice: number;
  unrealizedPl: number;
  unrealizedPlPct: number;
  positionPct: number;   // marketValue / equity — for the % display requirement
}

// Event pub/sub — sub-project C subscribes here for realtime notification dispatch.
export function subscribeToPositionEvents(
  listener: (e: PositionEvent) => void,
): () => void;   // returns unsubscribe fn
```

Reads return `null` (or empty arrays) when a horizon's runner isn't configured. Events are also persisted to `trader_position_events` so C can build a catch-up query on top for missed events across restarts.

### 9. Configuration — env vars

```
TRADER_ENABLED=true                              # master switch

# Per-horizon paper accounts (missing = runner disabled)
TRADER_3D_KEY_ID=...
TRADER_3D_SECRET=...
TRADER_5D_KEY_ID=...
TRADER_5D_SECRET=...
TRADER_10D_KEY_ID=...
TRADER_10D_SECRET=...
TRADER_ALPACA_PAPER_URL=https://paper-api.alpaca.markets

# Risk (ported defaults from auto3)
TRADER_RISK_PER_TRADE=0.01
TRADER_MAX_POSITION_PCT=0.10
TRADER_MAX_POSITIONS=8
TRADER_MAX_ENTRIES_PER_CYCLE=2
TRADER_MAX_ROTATIONS_PER_CYCLE=1
TRADER_CASH_FLOOR_PCT=0.02
TRADER_MIN_CONVICTION=1.0
TRADER_MAX_CONVICTION=2.0
TRADER_ROTATION_MIN_AGE_S=3600

# Session
TRADER_PREMARKET_MIN_HOUR=7                      # ET hour before which premarket entries blocked
TRADER_EXT_STOP_WIDEN=0.005                      # 0.5% wider stop in extended
TRADER_EXT_TARGET_WIDEN=0.005
TRADER_EXT_LIMIT_SLIP=0.001                      # 0.1% marketable-limit slip
```

`docker-compose.yml` gains the new env vars on the `app` service (all default-empty so absent config = runner disabled).

### 10. Failure modes

| Failure | Behaviour |
|---|---|
| Alpaca `429` | Exponential backoff (250ms, 1s, 3s), max 3 retries, then skip cycle for this runner. |
| Alpaca `5xx` | Log via `metrics.recordError({ kind: "alpaca" })` (admin console shows it), skip cycle. |
| Missing scan snapshot | Skip cycle, log warning. |
| Stale scan (>5 min old) | Skip cycle. |
| Runner startup | First cycle calls `syncPositions()` and treats Alpaca state as authoritative — no synthetic entry events for pre-existing positions. |
| Duplicate closes | `closing[symbol]` timeout of 600s prevents re-submitting a close until the previous one resolves or expires. |
| Bracket sanitization fails | Skip the entry/re-attach. Log to `trader_orders` with `status='error'`. |
| Broker constructor gets non-paper URL | Throws immediately. Runner disabled. |

### 11. Observability

- Every submitted order → row in `trader_orders`.
- Every fill (entry/exit/rotation) → row in `trader_position_events` AND in-process `EventEmitter` for C.
- `recordTraderCycle(horizon, durationMs, entries, exits, errors)` → added to `src/lib/data/metrics.ts`.
- Admin dashboard's Pipeline Health section (Task 8 of the admin plan, `PipelineHealthSection.tsx`) gains three stat tiles per horizon: last cycle age, entries+exits last hour, error count. Extension is additive — the existing four stats stay put.

### 12. Files

**Create:**
- `src/lib/trader/broker.ts` — Broker class + types + BrokerError.
- `src/lib/trader/sizing.ts` — `sizePosition(inputs)` pure function.
- `src/lib/trader/session.ts` — helpers: `etSession()`, `nextBarBoundary()`, `isStale()`.
- `src/lib/trader/runner.ts` — `TraderRunner` class + `PositionEvent` type.
- `src/lib/trader/index.ts` — bootstrap + public API.
- `src/lib/trader/settings.ts` — env-var → `TraderSettings` reader.
- `services/clickhouse/init/02_trader_schema.sql` — the two new tables (separate init file so it applies to fresh CH boots alongside `01_schema.sql`).

**Modify:**
- `services/clickhouse/init/01_schema.sql` — no change (kept immutable). New tables live in `02_trader_schema.sql`.
- `docker-compose.yml` — add all `TRADER_*` env vars on the `app` service, default-empty.
- `src/lib/data/metrics.ts` — add `recordTraderCycle(...)` + `getTraderCycleStats(horizon)`.
- `src/instrumentation.ts` — Next.js 16's built-in server startup hook. Create if missing; call `bootstrapTraders()` from the exported `register()` function. This is the canonical Next.js pattern for one-time server-side init and guarantees a single call per server boot.

### 13. Non-goals

- Non-paper (live) trading — the broker constructor guards against it.
- Custom order types beyond bracket, market, limit.
- User-facing trading UI — sub-project B.
- Notifications — sub-project C.
- Editing per-horizon settings at runtime via admin dashboard — env-var only in v1.
- Cross-horizon coordination (a symbol held on 3d does NOT block the 5d runner from buying it too — each account is independent).
- Historical PnL analytics beyond what `trader_position_events` naturally supports.
- Fractional shares — v1 rounds down to whole shares.
