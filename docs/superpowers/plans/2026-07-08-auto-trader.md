# Auto-trader (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert per-horizon scanner decisions into real orders on three Alpaca paper accounts (3d/5d/10d), with order/event persistence to ClickHouse and public read/event interfaces for sub-projects B (holdings UI) and C (notifications).

**Architecture:** Three `TraderRunner` instances live in the Next.js server process (same singleton pattern as the scanner and shadow monitors). Each is pinned to one paper account via env vars, wakes on 5-minute ET bar boundaries, and runs a fixed cycle: sync → reconcile fills → repair → sells → re-attach exit legs → buys → rotations. A thin `Broker` HTTP adapter (paper-URL-guarded) talks to Alpaca. Orders and position events persist to two new CH tables; fill slippage and exit memory feed back into the scanner's gate.

**Tech Stack:** TypeScript, Next.js 16 (instrumentation.ts bootstrap), Alpaca Trading REST API (paper), ClickHouse via `@clickhouse/client`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-07-auto-trader-design.md`

## Spec-resolution notes (read before implementing)

The spec was written against auto3's Python row shape. This codebase differs in three ways; the plan below already encodes the resolutions:

1. **`ScanRow` never has `decision === "SELL"` or a `reason` field.** The scanner evaluates every row with `isHeld: false`, so decisions are only BUY/WAIT/HOLD-CASH. The runner therefore computes the sell decision itself per held symbol by calling `sellDecision()` from `src/lib/engine/sell.ts` (signal-only path: hard stop/target rules + composite heuristics). Stop/target for held positions are re-anchored to the actual fill price via `computeStopTarget({ ref: avgPrice, ... })` — the row's own `stopPx`/`fairValueTargetPx` are 0 for non-BUY rows and would falsely trigger "take-profit" at any price. `isMember` proxy: `row.decision === "BUY" || row.decision === "WAIT"` (gate.ts only emits WAIT for members). `isRetained`: `row.role === "retained"`.
2. **Broker gains `submitOco()`.** Spec §2 step 6 requires re-attaching exit legs as an OCO, but the spec's Broker interface omitted the method. It is added with the same shape as `submitBracket` minus the entry.
3. **Fill prices append, not update.** CH MergeTree rows are immutable without mutations. When a fill is observed, the runner inserts a *second* `trader_orders` row with `status='filled'`, `fill_price`, and `slippage_bps`, referencing the same `alpaca_order_id`. Consumers group by `alpaca_order_id` and take the latest status.
4. **Rotation candidate selection** uses the existing `scoreRotations()` from `src/lib/engine/rotation.ts` (holding netBps/exitCost vs candidate netBps/entryCost) instead of auto3's package-EV budget algebra. The §65 sell-funded-cash budget is preserved: the incoming buy sizes against `freedCash + max(0, buyingPower − equity × cashFloorPct)`.

## Global Constraints

- **Paper-only:** `Broker` constructor throws unless `cfg.baseUrl.includes("paper")`. No code path may submit to a non-paper URL.
- **Whole shares only:** `sizePosition` floors to integer; qty 0 means "do not enter". No fractional order paths.
- **Master switch:** `TRADER_ENABLED=true` required; missing per-horizon `TRADER_<H>_KEY_ID`/`_SECRET` silently disables that runner.
- **Defaults (verbatim):** `TRADER_RISK_PER_TRADE=0.01`, `TRADER_MAX_POSITION_PCT=0.10`, `TRADER_MAX_POSITIONS=8`, `TRADER_MAX_ENTRIES_PER_CYCLE=2`, `TRADER_MAX_ROTATIONS_PER_CYCLE=1`, `TRADER_CASH_FLOOR_PCT=0.02`, `TRADER_MIN_CONVICTION=1.0`, `TRADER_MAX_CONVICTION=2.0`, `TRADER_ROTATION_MIN_AGE_S=3600`, `TRADER_REVERSAL_COOLDOWN_S=900`, `TRADER_PREMARKET_MIN_HOUR=7`, `TRADER_EXT_STOP_WIDEN=0.005`, `TRADER_EXT_TARGET_WIDEN=0.005`, `TRADER_EXT_LIMIT_SLIP=0.001`, `TRADER_ALPACA_PAPER_URL=https://paper-api.alpaca.markets`.
- **Magic numbers (verbatim):** closing tombstone 600 000 ms; stale-scan cutoff 300 000 ms; 429 backoff 250 ms / 1000 ms / 3000 ms then fail; slippage fallback 15 bps regular / 45 bps otherwise; slippage override after ≥ 5 samples; slippage ring buffer 100 per (symbol, side, session); action memory = `2 × expectedSlipBps × max(0, 1 − ageMin/edgeHorizonMin)`.
- **Fail-open persistence:** every CH function in `src/lib/trader/persistence.ts` catches internally, calls `recordError({ kind: "ch", ... })`, and returns a safe default. It never throws. Follow the pattern in `src/lib/shadow/persistence.ts`.
- **Runner failures never crash the server:** every cycle body is wrapped in try/catch; broker errors log via `recordError({ kind: "alpaca", ... })` and skip the cycle.
- **Cross-bundle singletons on `globalThis`:** any mutable module state written by the runners (bootstrapped from `instrumentation.ts`) and read by route handlers or the scanner MUST be anchored on `globalThis` (see Task 5 metrics and Task 8 runner registry). Next.js compiles instrumentation and route handlers into separate bundles with separate module instances — plain module-level Maps are invisible across the boundary (verified failure 2026-07-08 in the shadow monitors).
- **The trader never mutates scanner state.** The only scanner changes are the two gate inputs in Task 9 (`actionMemoryBps`, slippage added to gate `spreadBps`).
- **No test framework in this repo.** The gate per task is: `npm run build` (must pass) + `npx eslint <changed files>` (no NEW errors; 8 pre-existing errors live in unrelated files — do not fix or add to them). Never use synchronous `setState` in an effect body (`react-hooks/set-state-in-effect` is enforced).
- **CH conventions:** `JSONEachRow` inserts, `Number()` coercion on numeric round-trips, timestamps via `new Date(ms).toISOString()` on insert, bound `query_params` for any interpolated value.
- **Next.js 16:** this repo's Next has breaking changes; consult `node_modules/next/dist/docs/` if touching routing. `src/instrumentation.ts` must keep node-only imports behind the `process.env.NEXT_RUNTIME === "nodejs"` guard (an unguarded import broke the edge bundle on 2026-07-08).

---

### Task 1: CH trader schema + persistence layer

**Files:**
- Create: `services/clickhouse/init/02_trader_schema.sql`
- Create: `src/lib/trader/persistence.ts`

**Interfaces:**
- Consumes: `recordError` from `@/lib/data/metrics`.
- Produces: `TraderOrderRow`, `PositionEventRow` types; `insertTraderOrder(row): Promise<void>`, `insertPositionEvent(row): Promise<void>` — both fail-open. Task 6/7 call these; Task 8's public API re-exports the event type from runner, not here.

- [ ] **Step 1: Write the schema file**

Create `services/clickhouse/init/02_trader_schema.sql` with exactly:

```sql
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
```

- [ ] **Step 2: Write the persistence module**

Create `src/lib/trader/persistence.ts`:

```ts
// Fail-open ClickHouse persistence for the auto-trader. Every function
// catches internally and records the error — a CH outage must never stop
// the trading loop. Pattern mirrors src/lib/shadow/persistence.ts.

import { createClient, type ClickHouseClient } from "@clickhouse/client";
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
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
  } catch (err) {
    recordError({ kind: "ch", message: `trader CH client init failed: ${err}` });
    client = null;
  }
  return client;
}

export interface TraderOrderRow {
  horizon: string;
  submitted_at: string;          // ISO-8601
  symbol: string;
  side: "buy" | "sell";
  order_type: "bracket" | "limit" | "market" | "close" | "repair";
  qty: number;
  limit_price: number | null;
  stop_price: number | null;
  target_price: number | null;
  reason: string;
  alpaca_order_id: string;
  status: "submitted" | "filled" | "partial" | "canceled" | "error";
  expected_price: number | null;
  fill_price: number | null;
  slippage_bps: number | null;
}

export interface PositionEventRow {
  horizon: string;
  ts: string;                    // ISO-8601
  event_kind: "entry" | "exit" | "rotation" | "partial-fill";
  symbol: string;
  qty: number;
  fill_price: number;
  reason: string;
  pnl_bps: number | null;
  position_pct: number;
}

export async function insertTraderOrder(row: TraderOrderRow): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.insert({ table: "trader_orders", values: [row], format: "JSONEachRow" });
  } catch (err) {
    recordError({ kind: "ch", message: `insertTraderOrder(${row.symbol}) failed: ${err}` });
  }
}

export async function insertPositionEvent(row: PositionEventRow): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.insert({ table: "trader_position_events", values: [row], format: "JSONEachRow" });
  } catch (err) {
    recordError({ kind: "ch", message: `insertPositionEvent(${row.symbol}) failed: ${err}` });
  }
}
```

- [ ] **Step 3: Verify build + lint**

Run: `npm run build` — expect success. Run: `npx eslint src/lib/trader/persistence.ts` — expect no errors.

- [ ] **Step 4: Commit**

```bash
git add services/clickhouse/init/02_trader_schema.sql src/lib/trader/persistence.ts
git commit -m "feat(trader): CH order/event schema + fail-open persistence"
```

---

### Task 2: Session helpers

**Files:**
- Create: `src/lib/trader/session.ts`

**Interfaces:**
- Produces: `TraderSession = "premarket" | "regular" | "afterhours" | "closed"`; `etSession(now?): { session: TraderSession; etHour: number }`; `nextBarBoundary(nowMs?): number`; `isStale(generatedAtIso: string, maxAgeMs?): boolean`. Task 6/7 consume all three.

- [ ] **Step 1: Write the module**

Create `src/lib/trader/session.ts`:

```ts
// US/Eastern session detection + bar-boundary scheduling. Pure functions.
// Sessions per auto3 trader.py et_session():
//   premarket 4:00–9:30 ET, regular 9:30–16:00, afterhours 16:00–20:00,
//   closed otherwise (incl. weekends).

export type TraderSession = "premarket" | "regular" | "afterhours" | "closed";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function etParts(d: Date): { weekday: string; hour: number; minute: number } {
  const parts = ET_FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // Intl can render midnight as "24" with hour12:false — normalize.
  const hour = Number(get("hour")) % 24;
  return { weekday: get("weekday"), hour, minute: Number(get("minute")) };
}

export function etSession(now: Date = new Date()): { session: TraderSession; etHour: number } {
  const { weekday, hour, minute } = etParts(now);
  const etHour = hour + minute / 60;
  if (weekday === "Sat" || weekday === "Sun") return { session: "closed", etHour };
  if (etHour >= 4 && etHour < 9.5) return { session: "premarket", etHour };
  if (etHour >= 9.5 && etHour < 16) return { session: "regular", etHour };
  if (etHour >= 16 && etHour < 20) return { session: "afterhours", etHour };
  return { session: "closed", etHour };
}

const FIVE_MIN_MS = 5 * 60 * 1000;

// Next 5-minute boundary (ms epoch) that falls inside the 04:00–20:00 ET
// weekday window. ET offsets are whole hours, so UTC 5-min boundaries ARE
// ET 5-min boundaries. Bounded scan: a full weekend is < 900 steps.
export function nextBarBoundary(nowMs: number = Date.now()): number {
  let t = Math.floor(nowMs / FIVE_MIN_MS) * FIVE_MIN_MS + FIVE_MIN_MS;
  for (let i = 0; i < 4000; i++) {
    if (etSession(new Date(t)).session !== "closed") return t;
    t += FIVE_MIN_MS;
  }
  return t; // unreachable in practice
}

export function isStale(generatedAtIso: string, maxAgeMs = 300_000): boolean {
  const ts = Date.parse(generatedAtIso);
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > maxAgeMs;
}
```

- [ ] **Step 2: Spot-check with node**

Run: `node -e "const{etSession,nextBarBoundary}=require('./.next/server/nope')" ` — not possible pre-build; instead verify by build + a scratch check:

Run: `npx tsx -e "import {etSession,nextBarBoundary,isStale} from './src/lib/trader/session'; console.log(etSession(), new Date(nextBarBoundary()).toISOString(), isStale(new Date().toISOString()));"`
Expected: a session object, an ISO timestamp on a :00/:05 boundary inside 04:00–20:00 ET on a weekday, and `false`. (If `tsx` is unavailable, skip — the build in Step 3 type-checks it and Task 11 verifies behavior live.)

- [ ] **Step 3: Verify build + lint**

Run: `npm run build` and `npx eslint src/lib/trader/session.ts` — expect success / no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trader/session.ts
git commit -m "feat(trader): ET session detection + bar-boundary scheduler"
```

---

### Task 3: Sizing

**Files:**
- Create: `src/lib/trader/sizing.ts`

**Interfaces:**
- Produces: `TraderSettings`, `SizeInputs`, `sizePosition(i): number`, `convictionForRank(rank, n, settings): number`. Tasks 6/7/8 consume; `TraderSettings` includes the runner caps (spec's env vars need a home — see field list).

- [ ] **Step 1: Write the module**

Create `src/lib/trader/sizing.ts`:

```ts
// Risk-based position sizing, ported from auto3 trader.py size_position()
// (lines 492-521) with one deliberate change: WHOLE SHARES ONLY (spec v1) —
// raw < 1 returns 0 instead of a fractional qty.

export interface TraderSettings {
  riskPerTrade: number;        // fraction of equity risked if stop hits
  maxPositionPct: number;      // notional cap per position
  cashFloorPct: number;        // reserve kept out of rotation budgets
  minConviction: number;
  maxConviction: number;
  maxPositions: number;
  maxEntriesPerCycle: number;
  maxRotationsPerCycle: number;
  rotationMinAgeS: number;
  reversalCooldownS: number;
}

export interface SizeInputs {
  equity: number;
  buyingPower: number;
  price: number;
  stop: number;
  conviction: number;          // in [minConviction, maxConviction]
  cashAvailable?: number;      // override for rotation flow
  settings: TraderSettings;
}

// Whole-share qty, floored. 0 means "do not enter".
export function sizePosition(i: SizeInputs): number {
  const riskPerShare = i.price - i.stop;
  if (riskPerShare <= 0 || i.price <= 0 || i.equity <= 0) return 0;
  const riskBudget = i.equity * i.settings.riskPerTrade * i.conviction;
  const riskQty = riskBudget / riskPerShare;
  const notionalQty = (i.equity * i.settings.maxPositionPct) / i.price;
  const cash = i.cashAvailable ?? i.buyingPower;
  const cashQty = cash > 0 ? cash / i.price : 0;
  const raw = Math.min(riskQty, notionalQty, cashQty);
  return raw >= 1 ? Math.floor(raw) : 0;
}

// Spec §4: candidates ranked by net desc get conviction linearly from
// maxConviction (rank 1) down to minConviction (rank N). Single candidate
// gets maxConviction. rank is 1-based.
export function convictionForRank(rank: number, n: number, s: TraderSettings): number {
  if (n <= 1) return s.maxConviction;
  return s.maxConviction - ((rank - 1) * (s.maxConviction - s.minConviction)) / (n - 1);
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build` and `npx eslint src/lib/trader/sizing.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trader/sizing.ts
git commit -m "feat(trader): risk-based whole-share sizing + rank conviction"
```

---

### Task 4: Broker adapter

**Files:**
- Create: `src/lib/trader/broker.ts`

**Interfaces:**
- Produces: `BrokerError`, `BrokerConfig`, `AccountSnapshot`, `PositionState`, `OpenOrder`, `BracketArgs`, `OcoArgs`, `LimitArgs`, `Broker` class with `getAccount`, `getPositions`, `getOpenOrders`, `submitBracket`, `submitOco`, `submitLimit`, `cancelOrdersFor`, `closePosition`; helpers `roundPrice(px)`, `sanitizeBracket(price, stop, target)`. Tasks 6/7/8 consume.

- [ ] **Step 1: Write the module**

Create `src/lib/trader/broker.ts`:

```ts
// Thin typed wrapper over the Alpaca Trading REST API (paper only).
// Safety: constructor refuses any base URL that doesn't contain "paper".
// All operations throw BrokerError on failure; 429s get exponential backoff
// (250ms, 1s, 3s) then throw.

export class BrokerError extends Error {
  constructor(message: string, public status?: number, public alpacaCode?: string) {
    super(message);
    this.name = "BrokerError";
  }
}

export interface BrokerConfig {
  keyId: string;
  secret: string;
  baseUrl: string;   // must contain "paper"
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
  unrealizedPlPct: number;   // fraction, e.g. 0.023
}

export interface OpenOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: string;
  qty: number;
  limitPrice: number | null;
  stopPrice: number | null;
  submittedAt: string;
}

export interface BracketArgs {
  symbol: string;
  qty: number;
  entryLimit?: number;        // omit for market entry
  stopPrice: number;
  stopLimitPrice: number;
  takeProfitLimit: number;
  extended?: boolean;         // only honored for limit entries
}

export interface OcoArgs {
  symbol: string;
  qty: number;
  stopPrice: number;
  stopLimitPrice: number;
  takeProfitLimit: number;
}

export interface LimitArgs {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  limitPrice: number;
  extended?: boolean;
}

// Alpaca sub-penny rules: $0.01 tick at >= $1, $0.0001 below.
export function roundPrice(px: number): number {
  return px >= 1 ? Math.round(px * 100) / 100 : Math.round(px * 10000) / 10000;
}

// Validate/round a bracket's stop/target vs current price. Alpaca requires
// stop < price < target with >= 1 tick separation. Null when unfixable.
export function sanitizeBracket(
  price: number,
  stop: number,
  target: number,
): { stop: number; target: number } | null {
  if (!price || price <= 0) return null;
  const tick = price >= 1 ? 0.01 : 0.0001;
  const s = roundPrice(Math.min(stop, price - tick));
  const t = roundPrice(Math.max(target, price + tick));
  if (s <= 0 || s >= price || t <= price) return null;
  return { stop: s, target: t };
}

function px(v: number): string {
  return v >= 1 ? v.toFixed(2) : v.toFixed(4);
}

const BACKOFF_MS = [250, 1000, 3000];

interface RawOrder {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: string | null;
  limit_price: string | null;
  stop_price: string | null;
  submitted_at: string;
}

export class Broker {
  private headers: Record<string, string>;
  private base: string;

  constructor(cfg: BrokerConfig) {
    const base = cfg.baseUrl.replace(/\/+$/, "");
    if (!base.includes("paper")) {
      throw new BrokerError(
        `TRADER SAFETY: base URL ${base} is not a paper endpoint — refusing to start`,
      );
    }
    if (!cfg.keyId || !cfg.secret) {
      throw new BrokerError("TRADER SAFETY: missing key/secret");
    }
    this.base = base;
    this.headers = {
      "APCA-API-KEY-ID": cfg.keyId,
      "APCA-API-SECRET-KEY": cfg.secret,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers: this.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
      if (res.status === 429 && attempt < BACKOFF_MS.length) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        continue;
      }
      // DELETE endpoints return 204/207 with empty or multi-status bodies.
      if (res.ok || (method === "DELETE" && (res.status === 204 || res.status === 207 || res.status === 404))) {
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      }
      let code: string | undefined;
      let message = `${res.status} ${res.statusText}`;
      try {
        const err = (await res.json()) as { code?: number | string; message?: string };
        if (err.message) message = `${message}: ${err.message}`;
        code = err.code != null ? String(err.code) : undefined;
      } catch { /* non-JSON error body */ }
      throw new BrokerError(`alpaca ${method} ${path} failed: ${message}`, res.status, code);
    }
  }

  async getAccount(): Promise<AccountSnapshot> {
    const a = await this.request<{ equity: string; buying_power: string; cash: string }>(
      "GET", "/v2/account",
    );
    return {
      equity: Number(a.equity) || 0,
      buyingPower: Number(a.buying_power) || 0,
      cash: Number(a.cash) || 0,
    };
  }

  async getPositions(): Promise<Map<string, PositionState>> {
    const raw = await this.request<Array<Record<string, string>>>("GET", "/v2/positions");
    const out = new Map<string, PositionState>();
    for (const p of raw) {
      const qty = Number(p.qty) || 0;
      if (qty <= 0) continue;
      out.set(p.symbol, {
        symbol: p.symbol,
        qty,
        avgPrice: Number(p.avg_entry_price) || 0,
        marketValue: Number(p.market_value) || 0,
        currentPrice: Number(p.current_price) || 0,
        unrealizedPl: Number(p.unrealized_pl) || 0,
        unrealizedPlPct: Number(p.unrealized_plpc) || 0,
      });
    }
    return out;
  }

  async getOpenOrders(): Promise<OpenOrder[]> {
    const raw = await this.request<RawOrder[]>("GET", "/v2/orders?status=open&limit=500");
    return raw.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side === "sell" ? "sell" : "buy",
      orderType: o.type,
      qty: Number(o.qty) || 0,
      limitPrice: o.limit_price != null ? Number(o.limit_price) : null,
      stopPrice: o.stop_price != null ? Number(o.stop_price) : null,
      submittedAt: o.submitted_at,
    }));
  }

  async submitBracket(args: BracketArgs): Promise<{ orderId: string }> {
    const body: Record<string, unknown> = {
      symbol: args.symbol,
      qty: String(Math.floor(args.qty)),
      side: "buy",
      type: args.entryLimit != null ? "limit" : "market",
      time_in_force: "gtc",
      order_class: "bracket",
      take_profit: { limit_price: px(args.takeProfitLimit) },
      stop_loss: { stop_price: px(args.stopPrice), limit_price: px(args.stopLimitPrice) },
    };
    if (args.entryLimit != null) body.limit_price = px(args.entryLimit);
    const o = await this.request<{ id: string }>("POST", "/v2/orders", body);
    return { orderId: o.id };
  }

  async submitOco(args: OcoArgs): Promise<{ orderId: string }> {
    const o = await this.request<{ id: string }>("POST", "/v2/orders", {
      symbol: args.symbol,
      qty: String(Math.floor(args.qty)),
      side: "sell",
      type: "limit",
      time_in_force: "gtc",
      order_class: "oco",
      take_profit: { limit_price: px(args.takeProfitLimit) },
      stop_loss: { stop_price: px(args.stopPrice), limit_price: px(args.stopLimitPrice) },
    });
    return { orderId: o.id };
  }

  async submitLimit(args: LimitArgs): Promise<{ orderId: string }> {
    const o = await this.request<{ id: string }>("POST", "/v2/orders", {
      symbol: args.symbol,
      qty: String(Math.floor(args.qty)),
      side: args.side,
      type: "limit",
      limit_price: px(args.limitPrice),
      time_in_force: "day",
      extended_hours: !!args.extended,
    });
    return { orderId: o.id };
  }

  async cancelOrdersFor(symbol: string): Promise<void> {
    const open = await this.getOpenOrders();
    for (const o of open) {
      if (o.symbol !== symbol) continue;
      await this.request<unknown>("DELETE", `/v2/orders/${o.id}`);
    }
  }

  // Cancel the symbol's open orders (bracket legs), then liquidate.
  // Returns null when the liquidation itself fails (caller logs it).
  async closePosition(symbol: string): Promise<{ orderId: string } | null> {
    await this.cancelOrdersFor(symbol);
    await new Promise((r) => setTimeout(r, 250)); // let cancels settle
    try {
      const o = await this.request<{ id?: string }>("DELETE", `/v2/positions/${symbol}`);
      return o.id ? { orderId: o.id } : { orderId: "" };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build` and `npx eslint src/lib/trader/broker.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trader/broker.ts
git commit -m "feat(trader): paper-guarded Alpaca broker adapter"
```

---

### Task 5: Metrics extensions (cycle stats + slippage + action memory)

**Files:**
- Modify: `src/lib/data/metrics.ts` (append new sections at end of file)

**Interfaces:**
- Consumes: existing module structure (ring buffers, no side effects).
- Produces: `recordTraderCycle(horizon, durationMs, entries, exits, errors)`, `getTraderCycleStats(horizon): { lastCycleAt: number | null; entries1h: number; exits1h: number; errors1h: number }`, `recordSlippage(symbol, side, session, slipBps)`, `getExpectedSlippageBps(symbol, side, session): number`, `recordExit(symbol)`, `getActionMemoryBps(symbol, edgeHorizonMin): number`. `session` is `MarketPhase` from `@/lib/data/clock` ("regular" | "extended" | "closed"). Tasks 6/7 record; Task 9 reads in the scanner; Task 10 reads cycle stats.

- [ ] **Step 1: Append to `src/lib/data/metrics.ts`**

Add at the end of the file (and add `import type { MarketPhase } from "@/lib/data/clock";` at the top):

```ts
// -- Trader cycles (sub-project A) --------------------------------------------
// IMPORTANT: all trader metric state below is anchored on globalThis. The
// runner records from the instrumentation bundle while the scanner and admin
// routes read from route-handler bundles — Next.js gives each bundle its OWN
// module instance, so plain module-level Maps would never be visible to
// readers. (Verified failure mode 2026-07-08 in the shadow monitors.)

interface TraderCycleSample { ts: number; durationMs: number; entries: number; exits: number; errors: number }
const CYCLE_BUF_SIZE = 300;

type TraderMetricsState = {
  cycleBufs: Map<string, TraderCycleSample[]>;
  slipBufs: Map<string, number[]>;
  lastExitTs: Map<string, number>;
};
const globalTraderMetrics = globalThis as unknown as { __traderMetrics?: TraderMetricsState };
const traderMetrics: TraderMetricsState = (globalTraderMetrics.__traderMetrics ??= {
  cycleBufs: new Map(),
  slipBufs: new Map(),
  lastExitTs: new Map(),
});
const { cycleBufs, slipBufs, lastExitTs } = traderMetrics;

export function recordTraderCycle(
  horizon: string, durationMs: number, entries: number, exits: number, errors: number,
): void {
  let buf = cycleBufs.get(horizon);
  if (!buf) { buf = []; cycleBufs.set(horizon, buf); }
  buf.push({ ts: Date.now(), durationMs, entries, exits, errors });
  if (buf.length > CYCLE_BUF_SIZE) buf.shift();
}

export function getTraderCycleStats(horizon: string): {
  lastCycleAt: number | null; entries1h: number; exits1h: number; errors1h: number;
} {
  const buf = cycleBufs.get(horizon) ?? [];
  const cutoff = Date.now() - 3_600_000;
  const recent = buf.filter((s) => s.ts >= cutoff);
  return {
    lastCycleAt: buf.length ? buf[buf.length - 1].ts : null,
    entries1h: recent.reduce((a, s) => a + s.entries, 0),
    exits1h: recent.reduce((a, s) => a + s.exits, 0),
    errors1h: recent.reduce((a, s) => a + s.errors, 0),
  };
}

// -- Realized slippage feedback (spec §10) -------------------------------------
// Rolling window of 100 samples per (symbol, side, session). Below 5 samples
// the conservative default applies: 15 bps regular, 45 bps otherwise.

const SLIP_WINDOW = 100;
const SLIP_MIN_SAMPLES = 5;

function slipKey(symbol: string, side: "buy" | "sell", session: MarketPhase): string {
  return `${symbol}|${side}|${session}`;
}

export function recordSlippage(
  symbol: string, side: "buy" | "sell", session: MarketPhase, slipBps: number,
): void {
  if (!Number.isFinite(slipBps)) return;
  const key = slipKey(symbol, side, session);
  let buf = slipBufs.get(key);
  if (!buf) { buf = []; slipBufs.set(key, buf); }
  buf.push(Math.max(0, slipBps));
  if (buf.length > SLIP_WINDOW) buf.shift();
}

export function getExpectedSlippageBps(
  symbol: string, side: "buy" | "sell", session: MarketPhase,
): number {
  const buf = slipBufs.get(slipKey(symbol, side, session));
  if (buf && buf.length >= SLIP_MIN_SAMPLES) {
    return buf.reduce((a, b) => a + b, 0) / buf.length;
  }
  return session === "regular" ? 15 : 45;
}

// -- Action memory (spec §10 / gate.ts actionMemoryBps) -------------------------
// Per-symbol timestamp of the last trader exit. Cost decays linearly over the
// edge horizon: 2 × expected slippage × max(0, 1 − ageMin/edgeHorizonMin).

export function recordExit(symbol: string): void {
  lastExitTs.set(symbol, Date.now());
}

export function getActionMemoryBps(symbol: string, edgeHorizonMin: number): number {
  const ts = lastExitTs.get(symbol);
  if (!ts || edgeHorizonMin <= 0) return 0;
  const ageMin = (Date.now() - ts) / 60_000;
  const decay = Math.max(0, 1 - ageMin / edgeHorizonMin);
  if (decay === 0) { lastExitTs.delete(symbol); return 0; }
  return 2 * getExpectedSlippageBps(symbol, "buy", "regular") * decay;
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build` and `npx eslint src/lib/data/metrics.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/data/metrics.ts
git commit -m "feat(metrics): trader cycle stats + slippage/action-memory feedback"
```

---

### Task 6: Runner core — cycle scaffold, sync, reconcile, repair, sells, re-attach

**Files:**
- Create: `src/lib/trader/runner.ts`

**Interfaces:**
- Consumes: `Broker`, `PositionState`, `OpenOrder`, `AccountSnapshot`, `sanitizeBracket`, `roundPrice` (Task 4); `TraderSettings` (Task 3); `etSession`, `nextBarBoundary`, `isStale` (Task 2); `insertTraderOrder`, `insertPositionEvent` (Task 1); `recordTraderCycle`, `recordSlippage`, `recordExit`, `recordError` (Task 5 / existing); `getLatestSnapshot` from `@/lib/engine/scanner`; `sellDecision` from `@/lib/engine/sell`; `computeStopTarget` from `@/lib/engine/levels`; `calibrate`, `parseHorizon` from `@/lib/engine/horizon`; `ScanRow`, `ScanSnapshot` from `@/lib/engine/types`.
- Produces: `TraderRunner` class (`start`, `stop`, `getAccountSnapshot`, `getHoldings`, `getOpenOrders`, `getLastCycleAt`, `onEvent`), `PositionEvent`, `RunnerConfig`, `ExtendedSessionSettings`, `SessionSettings`, `TraderHorizon = "3d" | "5d" | "10d"`. Task 7 extends this same file with BUY/ROTATE steps; Task 8 wraps it.

This task implements the cycle through step 6 of spec §2 (sells + re-attach); the BUY/ROTATION steps land in Task 7. The cycle method calls `this.buyAndRotate(...)` which in THIS task is a stub that returns `{ entries: 0 }` — Task 7 replaces the stub body. This is the one intentional cross-task seam; the stub must exist so Task 6 builds.

- [ ] **Step 1: Write `src/lib/trader/runner.ts`**

```ts
// Per-horizon trading loop. One runner per Alpaca paper account. Wakes on
// 5-minute ET bar boundaries and executes the spec §2 cycle in order:
// sync → reconcile fills → repair → sells → re-attach exits → buys → rotations.
//
// The scanner evaluates all rows with isHeld:false, so held-position decisions
// are computed HERE via sellDecision() with stop/target re-anchored to the
// actual avg fill price (row levels are 0 on non-BUY rows).

import {
  Broker, BrokerError, sanitizeBracket, roundPrice,
  type AccountSnapshot, type OpenOrder, type PositionState,
} from "./broker";
import { sizePosition, convictionForRank, type TraderSettings } from "./sizing";
import { etSession, nextBarBoundary, isStale, type TraderSession } from "./session";
import { insertTraderOrder, insertPositionEvent } from "./persistence";
import {
  recordTraderCycle, recordSlippage, recordExit, recordError,
} from "@/lib/data/metrics";
import { getLatestSnapshot } from "@/lib/engine/scanner";
import { sellDecision } from "@/lib/engine/sell";
import { computeStopTarget } from "@/lib/engine/levels";
import { calibrate, parseHorizon } from "@/lib/engine/horizon";
import { scoreRotations } from "@/lib/engine/rotation";
import type { ScanRow } from "@/lib/engine/types";

export type TraderHorizon = "3d" | "5d" | "10d";

export interface ExtendedSessionSettings {
  stopWiden: number;    // TRADER_EXT_STOP_WIDEN
  targetWiden: number;  // TRADER_EXT_TARGET_WIDEN
  limitSlip: number;    // TRADER_EXT_LIMIT_SLIP
}

export interface SessionSettings {
  premarketMinHour: number;  // TRADER_PREMARKET_MIN_HOUR
}

export interface RunnerConfig {
  horizon: TraderHorizon;
  broker: Broker;
  settings: TraderSettings;
  extendedSettings: ExtendedSessionSettings;
  sessionSettings: SessionSettings;
}

export interface PositionEvent {
  horizon: TraderHorizon;
  ts: number;
  kind: "entry" | "exit" | "rotation";
  symbol: string;
  qty: number;
  fillPrice: number;
  reason: string;
  pnlBps: number | null;
  positionPct: number;
}

const CLOSING_TOMBSTONE_MS = 600_000;
const STALE_SCAN_MS = 300_000;

interface TrackedEntry {
  targetQty: number;
  expectedPrice: number;
  orderId: string;
  submittedAt: number;
  rotation: boolean;
}

export class TraderRunner {
  private cfg: RunnerConfig;
  private calib: ReturnType<typeof calibrate>;
  private horizonMin: number;

  private account: AccountSnapshot = { equity: 0, buyingPower: 0, cash: 0 };
  private positions = new Map<string, PositionState>();
  private prevPositions: Map<string, PositionState> | null = null; // null until first sync
  private openOrders: OpenOrder[] = [];
  private closing = new Map<string, number>();       // symbol → close-submitted ts
  private lastExit = new Map<string, number>();      // symbol → exit ts (cooldown)
  private entryTs = new Map<string, number>();       // symbol → entry-submitted ts
  private pendingEntries = new Map<string, TrackedEntry>();
  private listeners = new Set<(e: PositionEvent) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastCycleAt: number | null = null;
  private cycling = false;

  constructor(cfg: RunnerConfig) {
    this.cfg = cfg;
    this.horizonMin = parseHorizon(cfg.horizon);
    this.calib = calibrate(this.horizonMin);
  }

  start(): void {
    if (this.timer) return;
    this.scheduleNext();
    console.log(`[trader:${this.cfg.horizon}] runner started`);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getAccountSnapshot(): AccountSnapshot { return this.account; }
  getHoldings(): PositionState[] { return [...this.positions.values()]; }
  getOpenOrders(): OpenOrder[] { return [...this.openOrders]; }
  getLastCycleAt(): number | null { return this.lastCycleAt; }

  onEvent(listener: (e: PositionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scheduleNext(): void {
    const next = nextBarBoundary();
    this.timer = setTimeout(() => void this.cycle(), Math.max(1000, next - Date.now()));
  }

  private emit(e: PositionEvent): void {
    for (const l of this.listeners) {
      try { l(e); } catch { /* listener errors are the listener's problem */ }
    }
    void insertPositionEvent({
      horizon: e.horizon,
      ts: new Date(e.ts).toISOString(),
      event_kind: e.reason === "partial-fill" ? "partial-fill" : e.kind,
      symbol: e.symbol,
      qty: e.qty,
      fill_price: e.fillPrice,
      reason: e.reason,
      pnl_bps: e.pnlBps,
      position_pct: e.positionPct,
    });
    if (e.kind === "exit") {
      this.lastExit.set(e.symbol, e.ts);
      recordExit(e.symbol);
    }
  }

  private logOrder(row: {
    symbol: string; side: "buy" | "sell";
    order_type: "bracket" | "limit" | "market" | "close" | "repair";
    qty: number; reason: string; alpaca_order_id: string;
    status: "submitted" | "filled" | "partial" | "canceled" | "error";
    limit_price?: number | null; stop_price?: number | null; target_price?: number | null;
    expected_price?: number | null; fill_price?: number | null; slippage_bps?: number | null;
  }): void {
    void insertTraderOrder({
      horizon: this.cfg.horizon,
      submitted_at: new Date().toISOString(),
      limit_price: null, stop_price: null, target_price: null,
      expected_price: null, fill_price: null, slippage_bps: null,
      ...row,
    });
  }

  // Held-position stop/target anchored to the actual fill price. Row levels
  // are 0 for non-BUY rows and MUST NOT be used for held decisions.
  private heldLevels(row: ScanRow, pos: PositionState) {
    return computeStopTarget({
      ref: pos.avgPrice,
      volAnn: row.volAnn,
      holdingDays: Math.max(1, this.horizonMin / 390),
      composite: row.composite,
      confidence: row.confidence,
      currentPrice: row.price,
      spreadBps: row.spreadBps,
      calib: this.calib,
    });
  }

  private sellFor(row: ScanRow, pos: PositionState) {
    const st = this.heldLevels(row, pos);
    return {
      levels: st,
      result: sellDecision({
        price: row.price,
        stop: st.stop,
        target: st.fairValueTarget,
        composite: row.composite,
        isMember: row.decision === "BUY" || row.decision === "WAIT",
        isRetained: row.role === "retained",
      }),
    };
  }

  // ---- cycle ---------------------------------------------------------------

  private async cycle(): Promise<void> {
    if (this.cycling) { this.scheduleNext(); return; }
    this.cycling = true;
    const start = Date.now();
    let entries = 0, exits = 0, errors = 0;
    try {
      const { session, etHour } = etSession();
      if (session === "closed") return;

      const snap = await getLatestSnapshot(this.cfg.horizon);
      if (isStale(snap.generatedAt, STALE_SCAN_MS)) {
        console.warn(`[trader:${this.cfg.horizon}] stale scan (${snap.generatedAt}) — skipping cycle`);
        return;
      }
      const bySym = new Map(snap.rows.map((r) => [r.symbol, r]));

      // §2 steps 1-3: sync account, positions, open orders.
      this.account = await this.cfg.broker.getAccount();
      this.positions = await this.cfg.broker.getPositions();
      this.openOrders = await this.cfg.broker.getOpenOrders();
      for (const [sym] of this.closing) {
        if (!this.positions.has(sym)) this.closing.delete(sym);
      }

      // §2 step 4: reconcile fills against the previous cycle's positions.
      exits += this.reconcileFills();
      this.prevPositions = new Map(this.positions);

      // §12: repair pass — heal broker-state drift before acting.
      await this.repairPass();

      const ext = session === "premarket" || session === "afterhours";

      // §2 step 5: SELLS.
      exits += await this.runSells(bySym, session, ext);

      // §2 step 6: re-attach missing exit legs (RTH only).
      if (!ext) await this.reattachExits(bySym);

      // §2 steps 7-8: BUYS + ROTATIONS (Task 7).
      entries += (await this.buyAndRotate(snap.rows, bySym, session, etHour, ext)).entries;
    } catch (err) {
      errors++;
      const msg = err instanceof BrokerError ? err.message : String(err);
      recordError({ kind: "alpaca", message: `[trader:${this.cfg.horizon}] cycle failed: ${msg}` });
    } finally {
      this.lastCycleAt = Date.now();
      recordTraderCycle(this.cfg.horizon, Date.now() - start, entries, exits, errors);
      this.cycling = false;
      this.scheduleNext();
    }
  }

  // Diff current vs previous positions → entry/exit events. First cycle after
  // boot treats Alpaca state as authoritative (no synthetic events).
  private reconcileFills(): number {
    let exits = 0;
    if (this.prevPositions === null) {
      this.pendingEntries.clear();
      return 0;
    }
    const equity = Math.max(1, this.account.equity);

    for (const [sym, pos] of this.positions) {
      const prev = this.prevPositions.get(sym);
      const tracked = this.pendingEntries.get(sym);
      if (!prev) {
        // New position → entry event. Partial if tracked target > actual.
        const partial = tracked !== undefined && pos.qty < tracked.targetQty;
        if (tracked && tracked.expectedPrice > 0 && pos.avgPrice > 0) {
          const slip = ((pos.avgPrice - tracked.expectedPrice) / tracked.expectedPrice) * 10_000;
          recordSlippage(sym, "buy", "regular", slip);
          this.logOrder({
            symbol: sym, side: "buy", order_type: "bracket",
            qty: pos.qty, reason: partial ? "partial-fill" : "fill",
            alpaca_order_id: tracked.orderId,
            status: partial ? "partial" : "filled",
            expected_price: tracked.expectedPrice, fill_price: pos.avgPrice,
            slippage_bps: Math.round(slip * 10) / 10,
          });
        }
        this.emit({
          horizon: this.cfg.horizon, ts: Date.now(),
          kind: tracked?.rotation ? "rotation" : "entry",
          symbol: sym, qty: pos.qty, fillPrice: pos.avgPrice,
          reason: partial ? "partial-fill" : (tracked?.rotation ? "rotation-entry" : "entry"),
          pnlBps: null, positionPct: pos.marketValue / equity,
        });
        this.pendingEntries.delete(sym);
      } else if (pos.qty > prev.qty) {
        // Qty increase (bracket top-up etc.) → entry event with delta.
        this.emit({
          horizon: this.cfg.horizon, ts: Date.now(), kind: "entry",
          symbol: sym, qty: pos.qty - prev.qty, fillPrice: pos.avgPrice,
          reason: "qty-increase", pnlBps: null,
          positionPct: pos.marketValue / equity,
        });
      }
    }

    for (const [sym, prev] of this.prevPositions) {
      if (this.positions.has(sym)) continue;
      // Position gone → exit event. Best-effort PnL from last-seen unrealized.
      this.emit({
        horizon: this.cfg.horizon, ts: Date.now(), kind: "exit",
        symbol: sym, qty: prev.qty, fillPrice: prev.currentPrice,
        reason: "exit", pnlBps: Math.round(prev.unrealizedPlPct * 10_000),
        positionPct: 0,
      });
      exits++;
    }
    return exits;
  }

  // §12 repair pass: orphaned sells, duplicate sells, stale buys on held names.
  private async repairPass(): Promise<void> {
    const sellsBySym = new Map<string, OpenOrder[]>();
    for (const o of this.openOrders) {
      if (o.side !== "sell") continue;
      const arr = sellsBySym.get(o.symbol) ?? [];
      arr.push(o);
      sellsBySym.set(o.symbol, arr);
    }
    for (const [sym, orders] of sellsBySym) {
      if (!this.positions.has(sym)) {
        // Orphaned sell: no position behind it.
        await this.safeCancel(sym, "repair-orphan");
      } else if (orders.length > 1) {
        // Duplicate sell coverage: clear all; reattachExits re-arms this cycle.
        await this.safeCancel(sym, "repair-duplicate");
      }
    }
    for (const o of this.openOrders) {
      if (o.side === "buy" && this.positions.has(o.symbol)) {
        // Stale buy on a held name would double exposure on fill (§13).
        await this.safeCancel(o.symbol, "repair-stale-buy");
      }
    }
  }

  private async safeCancel(symbol: string, reason: string): Promise<void> {
    try {
      await this.cfg.broker.cancelOrdersFor(symbol);
      this.openOrders = this.openOrders.filter((o) => o.symbol !== symbol);
      this.logOrder({
        symbol, side: "sell", order_type: "repair", qty: 0,
        reason, alpaca_order_id: "", status: "canceled",
      });
    } catch (err) {
      recordError({ kind: "alpaca", message: `[trader:${this.cfg.horizon}] ${reason} cancel ${symbol} failed: ${err}` });
    }
  }

  private async runSells(
    bySym: Map<string, ScanRow>, session: TraderSession, ext: boolean,
  ): Promise<number> {
    let exits = 0;
    for (const [sym, pos] of this.positions) {
      const closingTs = this.closing.get(sym) ?? 0;
      if (Date.now() - closingTs < CLOSING_TOMBSTONE_MS) continue;
      const row = bySym.get(sym);
      if (!row || !row.price) continue;
      const { levels, result } = this.sellFor(row, pos);

      if (!ext) {
        // Regular hours: bracket legs own stop/target; runner closes at
        // market on any sellDecision SELL (signal exits + level safety net).
        if (result.decision !== "SELL") continue;
        const res = await this.cfg.broker.closePosition(sym);
        if (res !== null) {
          this.closing.set(sym, Date.now());
          this.lastExit.set(sym, Date.now());
          this.logOrder({
            symbol: sym, side: "sell", order_type: "close", qty: pos.qty,
            reason: `sell-${result.reason}`, alpaca_order_id: res.orderId,
            status: "submitted", expected_price: row.price,
          });
          exits++;
        }
      } else {
        // Extended session: legs don't run — watch widened levels, exit via
        // marketable extended limit.
        const extStop = levels.stop * (1 - this.cfg.extendedSettings.stopWiden);
        const extTarget = levels.fairValueTarget * (1 + this.cfg.extendedSettings.targetWiden);
        const signalExit =
          result.decision === "SELL" &&
          (result.reason === "reversal" || result.reason === "deteriorated");
        const stopHit = levels.stop > 0 && row.price <= extStop;
        const targetHit = levels.fairValueTarget > 0 && row.price >= extTarget;
        if (!(signalExit || stopHit || targetHit)) continue;
        if (Math.floor(pos.qty) < 1) continue; // extended rejects fractional
        const limit = roundPrice(row.price * (1 - this.cfg.extendedSettings.limitSlip));
        try {
          await this.cfg.broker.cancelOrdersFor(sym);
          await new Promise((r) => setTimeout(r, 250));
          const o = await this.cfg.broker.submitLimit({
            symbol: sym, side: "sell", qty: Math.floor(pos.qty),
            limitPrice: limit, extended: true,
          });
          this.closing.set(sym, Date.now());
          this.lastExit.set(sym, Date.now());
          this.logOrder({
            symbol: sym, side: "sell", order_type: "limit", qty: Math.floor(pos.qty),
            reason: signalExit ? `ext-signal-${result.reason}` : stopHit ? "ext-stop" : "ext-target",
            alpaca_order_id: o.orderId, status: "submitted",
            limit_price: limit, expected_price: row.price,
          });
          exits++;
        } catch (err) {
          recordError({ kind: "alpaca", message: `[trader:${this.cfg.horizon}] ext exit ${sym} (${session}) failed: ${err}` });
        }
      }
    }
    return exits;
  }

  // §2 step 6: any held position with no open sell coverage gets a fresh OCO.
  private async reattachExits(bySym: Map<string, ScanRow>): Promise<void> {
    const covered = new Set(
      this.openOrders.filter((o) => o.side === "sell").map((o) => o.symbol),
    );
    for (const [sym, pos] of this.positions) {
      if (covered.has(sym)) continue;
      if (Date.now() - (this.closing.get(sym) ?? 0) < CLOSING_TOMBSTONE_MS) continue;
      const row = bySym.get(sym);
      if (!row || !row.price) continue;
      const st = this.heldLevels(row, pos);
      const br = sanitizeBracket(row.price, st.stop, st.takeProfitLimit);
      if (br === null) continue; // unfixable levels — skip (spec §2 step 6)
      const stopLimit = roundPrice(Math.min(st.stopLimit, br.stop));
      try {
        const o = await this.cfg.broker.submitOco({
          symbol: sym, qty: Math.floor(pos.qty),
          stopPrice: br.stop, stopLimitPrice: stopLimit, takeProfitLimit: br.target,
        });
        this.openOrders.push({
          id: o.orderId, symbol: sym, side: "sell", orderType: "limit",
          qty: Math.floor(pos.qty), limitPrice: br.target, stopPrice: br.stop,
          submittedAt: new Date().toISOString(),
        });
        this.logOrder({
          symbol: sym, side: "sell", order_type: "limit", qty: Math.floor(pos.qty),
          reason: "reattach-oco", alpaca_order_id: o.orderId, status: "submitted",
          stop_price: br.stop, target_price: br.target,
        });
      } catch (err) {
        recordError({ kind: "alpaca", message: `[trader:${this.cfg.horizon}] OCO re-attach ${sym} failed: ${err}` });
      }
    }
  }

  // §2 steps 7-8. Implemented in Task 7.
  private async buyAndRotate(
    rows: ScanRow[], bySym: Map<string, ScanRow>,
    session: TraderSession, etHour: number, ext: boolean,
  ): Promise<{ entries: number }> {
    void rows; void bySym; void session; void etHour; void ext;
    void sizePosition; void convictionForRank; void scoreRotations;
    return { entries: 0 };
  }
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build` and `npx eslint src/lib/trader/runner.ts`. Note: `computeStopTarget`'s input type is `LevelInputs` in `src/lib/engine/levels.ts` — if field names differ from the call above (check `ref`, `volAnn`, `holdingDays`, `composite`, `confidence`, `currentPrice`, `spreadBps`, `calib` at `levels.ts:20-40`), adjust the call to match the real signature, not the other way around.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trader/runner.ts
git commit -m "feat(trader): runner core — cycle, sync, reconcile, repair, sells, re-attach"
```

---

### Task 7: Runner — buys, rotations, cooldown, partial-fill tracking

**Files:**
- Modify: `src/lib/trader/runner.ts` (replace the `buyAndRotate` stub)

**Interfaces:**
- Consumes: everything already imported in Task 6 (`sizePosition`, `convictionForRank`, `scoreRotations`, `sanitizeBracket`, broker methods, `pendingEntries`, `lastExit`, `entryTs` state).
- Produces: no new exports — completes `TraderRunner`.

- [ ] **Step 1: Replace the `buyAndRotate` stub**

Replace the entire stub method with:

```ts
  // §2 steps 7-8: BUYS then ROTATIONS. Returns entry count for cycle stats.
  private async buyAndRotate(
    rows: ScanRow[], bySym: Map<string, ScanRow>,
    session: TraderSession, etHour: number, ext: boolean,
  ): Promise<{ entries: number }> {
    // Session gates (§2 step 7).
    if (session === "afterhours") return { entries: 0 };
    if (session === "premarket" && etHour < this.cfg.sessionSettings.premarketMinHour) {
      return { entries: 0 };
    }

    const s = this.cfg.settings;
    const now = Date.now();
    const openBuySyms = new Set(
      this.openOrders.filter((o) => o.side === "buy").map((o) => o.symbol),
    );

    // Starred BUY rows, not held/pending, valid levels, past reversal cooldown.
    const candidates = rows
      .filter((r) =>
        r.decision === "BUY" && r.star &&
        !this.positions.has(r.symbol) &&
        !this.pendingEntries.has(r.symbol) &&
        !openBuySyms.has(r.symbol) &&
        r.price > 0 && r.stopPx > 0 && r.takeProfitLimitPx > 0 &&
        now - (this.lastExit.get(r.symbol) ?? 0) >= s.reversalCooldownS * 1000,
      )
      .sort((a, b) => b.net - a.net);

    let entries = 0;

    // ---- ROTATIONS first (RTH only): freed cash funds the incoming buy ----
    if (!ext && candidates.length > 0) {
      let rotations = 0;
      const usedTargets = new Set<string>();
      const heldRows = [...this.positions.keys()]
        .map((sym) => bySym.get(sym))
        .filter((r): r is ScanRow => r !== undefined)
        .sort((a, b) => a.net - b.net); // weakest first

      for (const heldRow of heldRows) {
        if (rotations >= s.maxRotationsPerCycle) break;
        const sym = heldRow.symbol;
        const pos = this.positions.get(sym);
        if (!pos) continue;
        if (heldRow.role === "primary" || heldRow.role === "secondary") continue;
        if (now - (this.closing.get(sym) ?? 0) < CLOSING_TOMBSTONE_MS) continue;
        if (now - (this.entryTs.get(sym) ?? 0) < s.rotationMinAgeS * 1000) continue;
        const { result } = this.sellFor(heldRow, pos);
        if (result.decision !== "HOLD") continue; // SELL path already handled it

        const targets = candidates
          .filter((c) => !usedTargets.has(c.symbol))
          .map((c) => ({
            symbol: c.symbol, role: c.role, netBps: c.net, entryCostBps: c.cost,
          }));
        if (targets.length === 0) break;
        const best = scoreRotations(
          {
            symbol: sym, role: heldRow.role,
            netBps: Math.max(0, heldRow.net),
            modelEdgeBps: heldRow.modelEdge,
            exitCostBps: heldRow.cExit,
          },
          targets,
        )[0];
        if (!best || !best.cleared) continue;
        const cand = bySym.get(best.toSymbol);
        if (!cand) continue;

        // §65 package budget: freed cash after modeled exit cost + spare cash
        // above the floor.
        const freedCash = pos.qty * heldRow.price * (1 - Math.max(0, heldRow.cExit) / 10_000);
        const spareCash = Math.max(0, this.account.buyingPower - this.account.equity * s.cashFloorPct);
        const budget = freedCash + spareCash;
        const conviction = (s.minConviction + s.maxConviction) / 2;
        const qty = sizePosition({
          equity: this.account.equity, buyingPower: this.account.buyingPower,
          price: cand.price, stop: cand.stopPx, conviction,
          cashAvailable: budget, settings: s,
        });
        if (qty < 1) continue;
        const br = sanitizeBracket(cand.price, cand.stopPx, cand.takeProfitLimitPx);
        if (br === null) continue;

        try {
          const closed = await this.cfg.broker.closePosition(sym);
          if (closed === null) continue;
          this.closing.set(sym, now);
          this.lastExit.set(sym, now);
          this.logOrder({
            symbol: sym, side: "sell", order_type: "close", qty: pos.qty,
            reason: `rotate-out→${cand.symbol}`, alpaca_order_id: closed.orderId,
            status: "submitted", expected_price: heldRow.price,
          });
          const o = await this.cfg.broker.submitBracket({
            symbol: cand.symbol, qty, stopPrice: br.stop,
            stopLimitPrice: roundPrice(Math.min(cand.stopLimitPx, br.stop)),
            takeProfitLimit: br.target,
          });
          this.pendingEntries.set(cand.symbol, {
            targetQty: qty, expectedPrice: cand.price, orderId: o.orderId,
            submittedAt: now, rotation: true,
          });
          this.entryTs.set(cand.symbol, now);
          usedTargets.add(cand.symbol);
          this.logOrder({
            symbol: cand.symbol, side: "buy", order_type: "bracket", qty,
            reason: `rotate-in←${sym}`, alpaca_order_id: o.orderId,
            status: "submitted", stop_price: br.stop, target_price: br.target,
            expected_price: cand.price,
          });
          rotations++;
          entries++;
        } catch (err) {
          recordError({ kind: "alpaca", message: `[trader:${this.cfg.horizon}] rotation ${sym}→${cand.symbol} failed: ${err}` });
        }
      }
      // Rotated-in symbols can't also be fresh entries this cycle.
      for (const t of usedTargets) {
        const idx = candidates.findIndex((c) => c.symbol === t);
        if (idx >= 0) candidates.splice(idx, 1);
      }
    }

    // ---- BUYS ----
    const n = candidates.length;
    let bought = 0;
    for (let i = 0; i < n; i++) {
      if (bought >= s.maxEntriesPerCycle) break;
      if (this.positions.size + this.pendingEntries.size >= s.maxPositions) break;
      const r = candidates[i];
      const br = sanitizeBracket(r.price, r.stopPx, r.takeProfitLimitPx);
      if (br === null) continue;
      const conviction = convictionForRank(i + 1, n, s);
      const qty = sizePosition({
        equity: this.account.equity, buyingPower: this.account.buyingPower,
        price: r.price, stop: br.stop, conviction, settings: s,
      });
      if (qty < 1) continue;

      try {
        let orderId: string;
        let orderType: "bracket" | "limit";
        if (!ext) {
          const o = await this.cfg.broker.submitBracket({
            symbol: r.symbol, qty, stopPrice: br.stop,
            stopLimitPrice: roundPrice(Math.min(r.stopLimitPx, br.stop)),
            takeProfitLimit: br.target,
          });
          orderId = o.orderId;
          orderType = "bracket";
        } else {
          // Premarket ≥ min hour: extended marketable limit buy; exit legs
          // re-attach at the first regular-hours cycle.
          const limit = roundPrice(r.price * (1 + this.cfg.extendedSettings.limitSlip));
          const o = await this.cfg.broker.submitLimit({
            symbol: r.symbol, side: "buy", qty, limitPrice: limit, extended: true,
          });
          orderId = o.orderId;
          orderType = "limit";
        }
        this.pendingEntries.set(r.symbol, {
          targetQty: qty, expectedPrice: r.price, orderId,
          submittedAt: now, rotation: false,
        });
        this.entryTs.set(r.symbol, now);
        this.logOrder({
          symbol: r.symbol, side: "buy", order_type: orderType, qty,
          reason: "star-entry", alpaca_order_id: orderId, status: "submitted",
          stop_price: br.stop, target_price: br.target, expected_price: r.price,
        });
        bought++;
        entries++;
      } catch (err) {
        recordError({ kind: "alpaca", message: `[trader:${this.cfg.horizon}] BUY ${r.symbol} failed: ${err}` });
      }
    }

    return { entries };
  }
```

Also remove the now-unneeded `void sizePosition; void convictionForRank; void scoreRotations;` suppressions (they were only for the stub), and remove `void rows; ...` lines.

- [ ] **Step 2: Verify build + lint**

Run: `npm run build` and `npx eslint src/lib/trader/runner.ts`. Check that `stopLimitPx` exists on ScanRow (it does — `src/lib/engine/types.ts:68`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/trader/runner.ts
git commit -m "feat(trader): entries, rotations, reversal cooldown, partial-fill tracking"
```

---

### Task 8: Settings reader, bootstrap, public API, instrumentation, compose env

**Files:**
- Create: `src/lib/trader/settings.ts`
- Create: `src/lib/trader/index.ts`
- Modify: `src/instrumentation.ts`
- Modify: `docker-compose.yml` (app service environment)
- Modify: `.env.example`, `.env.docker.example`

**Interfaces:**
- Consumes: `TraderRunner`, `RunnerConfig`, `PositionEvent`, `TraderHorizon` (Task 6/7); `Broker`, `AccountSnapshot`, `OpenOrder`, `PositionState` (Task 4); `TraderSettings` (Task 3).
- Produces: `bootstrapTraders(): void`, `getRunner(h): TraderRunner | null`, `getHoldings(h): Promise<Holding[]>`, `getOpenOrders(h): Promise<OpenOrder[]>`, `getAccountSummary(h): Promise<(AccountSnapshot & { positionCount: number }) | null>`, `subscribeToPositionEvents(listener): () => void`, `Holding` type. Sub-projects B/C consume these.

- [ ] **Step 1: Write `src/lib/trader/settings.ts`**

```ts
// Env-var → settings readers. Read once at bootstrap; changes need a restart.

import type { TraderSettings } from "./sizing";
import type { ExtendedSessionSettings, SessionSettings } from "./runner";

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== ""
    ? v
    : fallback;
}

export function readTraderSettings(): TraderSettings {
  return {
    riskPerTrade: envNum("TRADER_RISK_PER_TRADE", 0.01),
    maxPositionPct: envNum("TRADER_MAX_POSITION_PCT", 0.10),
    cashFloorPct: envNum("TRADER_CASH_FLOOR_PCT", 0.02),
    minConviction: envNum("TRADER_MIN_CONVICTION", 1.0),
    maxConviction: envNum("TRADER_MAX_CONVICTION", 2.0),
    maxPositions: envNum("TRADER_MAX_POSITIONS", 8),
    maxEntriesPerCycle: envNum("TRADER_MAX_ENTRIES_PER_CYCLE", 2),
    maxRotationsPerCycle: envNum("TRADER_MAX_ROTATIONS_PER_CYCLE", 1),
    rotationMinAgeS: envNum("TRADER_ROTATION_MIN_AGE_S", 3600),
    reversalCooldownS: envNum("TRADER_REVERSAL_COOLDOWN_S", 900),
  };
}

export function readExtendedSettings(): ExtendedSessionSettings {
  return {
    stopWiden: envNum("TRADER_EXT_STOP_WIDEN", 0.005),
    targetWiden: envNum("TRADER_EXT_TARGET_WIDEN", 0.005),
    limitSlip: envNum("TRADER_EXT_LIMIT_SLIP", 0.001),
  };
}

export function readSessionSettings(): SessionSettings {
  return { premarketMinHour: envNum("TRADER_PREMARKET_MIN_HOUR", 7) };
}
```

- [ ] **Step 2: Write `src/lib/trader/index.ts`**

```ts
// Trader bootstrap + public read/event API (spec §6/§8). One TraderRunner per
// horizon that has paper credentials configured. Idempotent; silent no-op
// unless TRADER_ENABLED=true.

import { Broker, type AccountSnapshot, type OpenOrder, type PositionState } from "./broker";
import { TraderRunner, type PositionEvent, type TraderHorizon } from "./runner";
import { readTraderSettings, readExtendedSettings, readSessionSettings } from "./settings";

export type { PositionEvent, TraderHorizon } from "./runner";
export type { AccountSnapshot, OpenOrder, PositionState } from "./broker";

const HORIZONS: TraderHorizon[] = ["3d", "5d", "10d"];

// Next.js compiles instrumentation.ts and route handlers into SEPARATE
// bundles, each with its own copy of this module's top-level state. Anchor
// the singleton on globalThis so bootstrap (instrumentation) and consumers
// (admin routes, sub-project B) share the same runners. Verified failure
// mode 2026-07-08: the shadow monitors used plain module state and the API
// routes saw an empty map while bootstrap had populated its own copy.
type TraderState = {
  runners: Map<TraderHorizon, TraderRunner>;
  bootstrapped: boolean;
};
const globalTrader = globalThis as unknown as { __traderState?: TraderState };
const state: TraderState = (globalTrader.__traderState ??= {
  runners: new Map(),
  bootstrapped: false,
});
const runners = state.runners;

export function bootstrapTraders(): void {
  if (state.bootstrapped) return;
  state.bootstrapped = true;
  if (process.env.TRADER_ENABLED !== "true") {
    console.log("[trader] TRADER_ENABLED != 'true'; runners disabled");
    return;
  }
  const baseUrl = process.env.TRADER_ALPACA_PAPER_URL ?? "https://paper-api.alpaca.markets";
  const settings = readTraderSettings();
  const extendedSettings = readExtendedSettings();
  const sessionSettings = readSessionSettings();

  for (const horizon of HORIZONS) {
    const envKey = horizon.toUpperCase(); // "3D" | "5D" | "10D"
    const keyId = process.env[`TRADER_${envKey}_KEY_ID`];
    const secret = process.env[`TRADER_${envKey}_SECRET`];
    if (!keyId || !secret) {
      console.log(`[trader:${horizon}] no credentials — runner disabled`);
      continue;
    }
    try {
      const broker = new Broker({ keyId, secret, baseUrl });
      const runner = new TraderRunner({ horizon, broker, settings, extendedSettings, sessionSettings });
      runner.start();
      runners.set(horizon, runner);
    } catch (err) {
      console.error(`[trader:${horizon}] bootstrap failed:`, err);
    }
  }

  const shutdown = () => { for (const r of runners.values()) r.stop(); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function getRunner(horizon: TraderHorizon): TraderRunner | null {
  return runners.get(horizon) ?? null;
}

// -- Read API for sub-project B ------------------------------------------------

export interface Holding {
  symbol: string;
  qty: number;
  avgPrice: number;
  marketValue: number;
  currentPrice: number;
  unrealizedPl: number;
  unrealizedPlPct: number;
  positionPct: number;   // marketValue / equity
}

export async function getHoldings(horizon: TraderHorizon): Promise<Holding[]> {
  const r = runners.get(horizon);
  if (!r) return [];
  const equity = Math.max(1, r.getAccountSnapshot().equity);
  return r.getHoldings().map((p: PositionState) => ({
    symbol: p.symbol,
    qty: p.qty,
    avgPrice: p.avgPrice,
    marketValue: p.marketValue,
    currentPrice: p.currentPrice,
    unrealizedPl: p.unrealizedPl,
    unrealizedPlPct: p.unrealizedPlPct,
    positionPct: p.marketValue / equity,
  }));
}

export async function getOpenOrders(horizon: TraderHorizon): Promise<OpenOrder[]> {
  return runners.get(horizon)?.getOpenOrders() ?? [];
}

export async function getAccountSummary(
  horizon: TraderHorizon,
): Promise<(AccountSnapshot & { positionCount: number }) | null> {
  const r = runners.get(horizon);
  if (!r) return null;
  return { ...r.getAccountSnapshot(), positionCount: r.getHoldings().length };
}

// -- Event pub/sub for sub-project C --------------------------------------------

export function subscribeToPositionEvents(
  listener: (e: PositionEvent) => void,
): () => void {
  const unsubs = [...runners.values()].map((r) => r.onEvent(listener));
  return () => { for (const u of unsubs) u(); };
}
```

- [ ] **Step 3: Wire into `src/instrumentation.ts`**

The file currently guards node-only imports behind `NEXT_RUNTIME` (do NOT move imports to top level — that broke the edge bundle on 2026-07-08). Change the guarded block to:

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapShadowMonitors } = await import("@/lib/shadow");
    bootstrapShadowMonitors();
    const { bootstrapTraders } = await import("@/lib/trader");
    bootstrapTraders();
  }
}
```

- [ ] **Step 4: docker-compose + env examples**

In `docker-compose.yml`, add to the `app` service `environment:` block (alongside `SHADOW_ENABLED`):

```yaml
      TRADER_ENABLED: ${TRADER_ENABLED:-false}
      TRADER_ALPACA_PAPER_URL: ${TRADER_ALPACA_PAPER_URL:-https://paper-api.alpaca.markets}
      TRADER_3D_KEY_ID: ${TRADER_3D_KEY_ID:-}
      TRADER_3D_SECRET: ${TRADER_3D_SECRET:-}
      TRADER_5D_KEY_ID: ${TRADER_5D_KEY_ID:-}
      TRADER_5D_SECRET: ${TRADER_5D_SECRET:-}
      TRADER_10D_KEY_ID: ${TRADER_10D_KEY_ID:-}
      TRADER_10D_SECRET: ${TRADER_10D_SECRET:-}
      TRADER_RISK_PER_TRADE: ${TRADER_RISK_PER_TRADE:-0.01}
      TRADER_MAX_POSITION_PCT: ${TRADER_MAX_POSITION_PCT:-0.10}
      TRADER_MAX_POSITIONS: ${TRADER_MAX_POSITIONS:-8}
      TRADER_MAX_ENTRIES_PER_CYCLE: ${TRADER_MAX_ENTRIES_PER_CYCLE:-2}
      TRADER_MAX_ROTATIONS_PER_CYCLE: ${TRADER_MAX_ROTATIONS_PER_CYCLE:-1}
      TRADER_CASH_FLOOR_PCT: ${TRADER_CASH_FLOOR_PCT:-0.02}
      TRADER_MIN_CONVICTION: ${TRADER_MIN_CONVICTION:-1.0}
      TRADER_MAX_CONVICTION: ${TRADER_MAX_CONVICTION:-2.0}
      TRADER_ROTATION_MIN_AGE_S: ${TRADER_ROTATION_MIN_AGE_S:-3600}
      TRADER_REVERSAL_COOLDOWN_S: ${TRADER_REVERSAL_COOLDOWN_S:-900}
      TRADER_PREMARKET_MIN_HOUR: ${TRADER_PREMARKET_MIN_HOUR:-7}
      TRADER_EXT_STOP_WIDEN: ${TRADER_EXT_STOP_WIDEN:-0.005}
      TRADER_EXT_TARGET_WIDEN: ${TRADER_EXT_TARGET_WIDEN:-0.005}
      TRADER_EXT_LIMIT_SLIP: ${TRADER_EXT_LIMIT_SLIP:-0.001}
```

Note the compose default for `TRADER_ENABLED` is **false** (opt-in on the server), while spec §9 shows `TRADER_ENABLED=true` as the example value in `.env`.

In `.env.example` and `.env.docker.example`, append:

```
# Auto-trader (sub-project A). Master switch + one paper account per horizon.
TRADER_ENABLED=false
TRADER_ALPACA_PAPER_URL=https://paper-api.alpaca.markets
TRADER_3D_KEY_ID=
TRADER_3D_SECRET=
TRADER_5D_KEY_ID=
TRADER_5D_SECRET=
TRADER_10D_KEY_ID=
TRADER_10D_SECRET=
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build` and `npx eslint src/lib/trader/settings.ts src/lib/trader/index.ts src/instrumentation.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trader/settings.ts src/lib/trader/index.ts src/instrumentation.ts docker-compose.yml .env.example .env.docker.example
git commit -m "feat(trader): bootstrap, public read/event API, env wiring"
```

---

### Task 9: Scanner feedback wiring (action memory + slippage)

**Files:**
- Modify: `src/lib/engine/scanner.ts`

**Interfaces:**
- Consumes: `getActionMemoryBps`, `getExpectedSlippageBps` from `@/lib/data/metrics` (Task 5).
- Produces: no new exports — the two gate call sites gain feedback inputs.

- [ ] **Step 1: Wire the imports**

In `src/lib/engine/scanner.ts`, extend the existing metrics import (line 47):

```ts
import { recordScanDuration, getActionMemoryBps, getExpectedSlippageBps } from "@/lib/data/metrics";
```

- [ ] **Step 2: Wire pass 1 (scanner.ts:315, inside the `pass1` map)**

The `gateDecision` call currently passes `spreadBps: p.spreadBps` and no `actionMemoryBps`. Change those two inputs (leave every other field untouched):

```ts
      spreadBps: p.spreadBps + getExpectedSlippageBps(p.symbol, "buy", clockState.phase),
      actionMemoryBps: getActionMemoryBps(p.symbol, horizonMin),
```

- [ ] **Step 3: Wire pass 2 (scanner.ts:367, inside the `out` map)**

Same two changes on the second `gateDecision` call:

```ts
      spreadBps: p.spreadBps + getExpectedSlippageBps(p.symbol, "buy", clockState.phase),
      actionMemoryBps: getActionMemoryBps(p.symbol, horizonMin),
```

IMPORTANT: only the **gate inputs** change. The row's own `spreadBps` field (used by `computeStopTarget`, the UI, and CH persistence) stays `p.spreadBps` — spec §10 says slippage is added "before calling the gate", not baked into the row.

- [ ] **Step 4: Verify build + lint**

Run: `npm run build` and `npx eslint src/lib/engine/scanner.ts`.

Behavioral sanity: before any trader fill exists, `getExpectedSlippageBps` returns the 15/45 bps default, so every gate call now carries a slightly higher hurdle than before. This is the spec's intent (§10: "the gate uses conservative defaults") — expect marginal BUY rows near net≈0 to flip to WAIT. Do not "fix" this.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/scanner.ts
git commit -m "feat(scanner): slippage + action-memory feedback into gate (spec §10)"
```

---

### Task 10: Admin pipeline-health trader tiles

**Files:**
- Modify: `src/app/api/admin/summary/route.ts`
- Modify: `src/app/admin/sections/PipelineHealthSection.tsx`

**Interfaces:**
- Consumes: `getTraderCycleStats` (Task 5); existing `AdminSummary` shape.
- Produces: `AdminSummary["pipeline"]` gains `trader: Array<{ horizon: string; lastCycleAgeS: number | null; entries1h: number; exits1h: number; errors1h: number }>`.

- [ ] **Step 1: Extend the API**

In `src/app/api/admin/summary/route.ts`:

1. Extend the metrics import: `import { getAlpacaSuccessRate, getScanLatencyP95, getTraderCycleStats } from "@/lib/data/metrics";`
2. Extend the `pipeline` field of `AdminSummary`:

```ts
  pipeline: {
    alpacaSuccess1h: number;
    fundamentalsCacheHit: number | null;
    chBars24h: number;
    chScanRows24h: number;
    scanP95Ms: number;
    trader: Array<{
      horizon: string;
      lastCycleAgeS: number | null;
      entries1h: number;
      exits1h: number;
      errors1h: number;
    }>;
  };
```

3. In `fetchPipeline()`, add to the returned object:

```ts
    trader: ["3d", "5d", "10d"].map((horizon) => {
      const s = getTraderCycleStats(horizon);
      return {
        horizon,
        lastCycleAgeS: s.lastCycleAt == null ? null : Math.round((Date.now() - s.lastCycleAt) / 1000),
        entries1h: s.entries1h,
        exits1h: s.exits1h,
        errors1h: s.errors1h,
      };
    }),
```

- [ ] **Step 2: Extend the section (additive — the existing five stats stay put)**

In `src/app/admin/sections/PipelineHealthSection.tsx`, after the existing stats grid `</div>` (inside the non-null branch), add:

```tsx
            <div className="mt-4 grid grid-cols-3 gap-4">
              {pipeline.trader.map((t) => (
                <Stat
                  key={t.horizon}
                  label={`Trader ${t.horizon}`}
                  value={t.lastCycleAgeS == null ? "off" : `${t.lastCycleAgeS}s`}
                  sub={`${t.entries1h}in ${t.exits1h}out ${t.errors1h}err /1h`}
                />
              ))}
            </div>
```

This requires wrapping both grids in a fragment (`<>...</>`) since the ternary branch must return one node.

- [ ] **Step 3: Verify build + lint**

Run: `npm run build` and `npx eslint src/app/api/admin/summary/route.ts src/app/admin/sections/PipelineHealthSection.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/summary/route.ts src/app/admin/sections/PipelineHealthSection.tsx
git commit -m "feat(admin): trader cycle tiles in pipeline health"
```

---

### Task 11: End-to-end verification (server)

**Files:** none — validation only. No commit for this task.

Prereq: three Alpaca paper accounts created; keys in the server's `.env` as `TRADER_3D_KEY_ID/SECRET`, `TRADER_5D_KEY_ID/SECRET`, `TRADER_10D_KEY_ID/SECRET`, plus `TRADER_ENABLED=true`.

- [ ] **Step 1: Apply the CH schema** (init scripts only auto-run on fresh volumes, into `default`):

```bash
cat services/clickhouse/init/02_trader_schema.sql | docker exec -i singscanner-ch clickhouse-client -d singscanner --multiquery
docker exec singscanner-ch clickhouse-client -d singscanner --query "SHOW TABLES LIKE 'trader_%'"
```

Expected: `trader_orders`, `trader_position_events`.

- [ ] **Step 2: Rebuild and recreate** (not `restart` — env changes need recreation):

```bash
git pull && docker compose up -d --build app
```

- [ ] **Step 3: Confirm bootstrap:**

```bash
docker logs singscanner-app --since 3m | grep trader
```

Expected: `[trader:3d] runner started` (×3), no "disabled" lines for configured horizons, no bootstrap errors.

- [ ] **Step 4: First cycle.** Wait past the next 5-min ET boundary (during 04:00–20:00 ET on a weekday), then:

```bash
docker logs singscanner-app --since 10m | grep trader
```

Expected: no cycle errors. Off-hours: nothing happens until the next session — verify Step 5 shows `off`/no data and re-run during market hours.

- [ ] **Step 5: Admin tiles.** Visit `/admin` → Pipeline health. Expected: three `Trader <h>` tiles with a last-cycle age ≤ ~330s during trading windows.

- [ ] **Step 6: Orders flow (during regular hours with BUY stars present):**

```bash
docker exec singscanner-ch clickhouse-client -d singscanner --query "SELECT horizon, symbol, side, order_type, reason, status FROM trader_orders ORDER BY submitted_at DESC LIMIT 20"
```

Expected: `star-entry` bracket rows (and later `fill` rows). Cross-check the Alpaca paper dashboard shows the same orders.

- [ ] **Step 7: Position events:**

```bash
docker exec singscanner-ch clickhouse-client -d singscanner --query "SELECT horizon, event_kind, symbol, qty, fill_price, reason FROM trader_position_events ORDER BY ts DESC LIMIT 20"
```

Expected: `entry` events for filled brackets, with `position_pct` > 0.

- [ ] **Step 8: Safety checks:**
- Temporarily set `TRADER_ALPACA_PAPER_URL=https://api.alpaca.markets` for one horizon in a scratch shell and confirm the runner logs `TRADER SAFETY` and stays disabled (then revert).
- Confirm `TRADER_ENABLED=false` (compose default) produces `[trader] TRADER_ENABLED != 'true'; runners disabled` and zero Alpaca calls.

- [ ] **Step 9: Feedback loop.** After at least one fill, confirm gate feedback is alive: expire a position (or wait for an exit) and check that the exited symbol shows a positive `cMemory` in its dashboard row tooltip on the next scan.

---

## Self-review

**Spec coverage:**
- ✅ §1 architecture — three in-process runners (Task 6/8).
- ✅ §2 cadence + ordered cycle — session.ts boundaries (Task 2), cycle order sync→reconcile→repair→sells→re-attach→buys→rotations (Tasks 6-7), stale-scan guard.
- ✅ §3 broker — Task 4, paper guard, 429 backoff, all methods (+documented `submitOco` addition).
- ✅ §4/§5 sizing + conviction — Task 3 (spec's rank-linear formula, not auto3's score map — spec governs).
- ✅ §5 runner interface — Task 6 exposes all getters + onEvent.
- ✅ §6 bootstrap — Task 8, env-read-once, silent no-op.
- ✅ §7 data model — Task 1, both tables verbatim (file is `02_trader_schema.sql` per spec §16).
- ✅ §8 public interfaces — Task 8 (`getHoldings`/`getOpenOrders`/`getAccountSummary`/`subscribeToPositionEvents`), events persisted for catch-up.
- ✅ §9 env vars — Task 8 compose + env examples.
- ✅ §10 feedback loops — Task 5 (helpers) + Task 9 (gate wiring, gate-input-only).
- ✅ §11 reversal cooldown — Task 7 candidate filter.
- ✅ §12 repair pass — Task 6 `repairPass()`, logged with `repair-*` reasons, no events.
- ✅ §13 partial fills — Task 6 reconcile (tracked targetQty vs actual, partial event, no follow-up buy; residual buy legs canceled by repair).
- ✅ §14 failure modes — backoff (Task 4), recordError+skip (Task 6), stale/missing scan skip, first-cycle authoritative sync, closing tombstone, sanitize-fail skip, non-paper throw.
- ✅ §15 observability — order rows, event rows + emitter, recordTraderCycle (Task 5), admin tiles (Task 10).
- ✅ §17 non-goals respected — no live trading, no fractional, no 21d, no UI/notifications, no runtime settings editing, no cross-horizon coordination.

**Placeholder scan:** No TBDs. The single intentional seam is Task 6's `buyAndRotate` stub, which Task 7 replaces with the complete implementation shown in Task 7 Step 1.

**Type consistency:** `TraderHorizon`, `PositionEvent`, `RunnerConfig`, `ExtendedSessionSettings`, `SessionSettings` defined in runner.ts; `TraderSettings`/`SizeInputs` in sizing.ts; broker types in broker.ts; persistence row types in persistence.ts — each defined once and imported elsewhere. `sellDecision`/`computeStopTarget`/`scoreRotations`/`calibrate`/`parseHorizon`/`getLatestSnapshot` signatures verified against the current engine sources (2026-07-08). `getTraderCycleStats` return shape matches Task 10's consumption. Known deviation callouts: `TraderSettings` carries the runner caps (spec listed them only as env vars); `submitOco` added; fills append a second order row instead of updating.
