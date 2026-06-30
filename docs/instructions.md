# Singularity Scanner — Next.js Full-Stack Rebuild Specification

## Overview

Rebuild the Singularity after-cost stock scanner as a full-stack Next.js application
with user accounts, individual portfolios, and real-time scanning. The current
implementation is a single-user Python/FastAPI app with an embedded HTML dashboard.
The rebuild preserves every formula and decision in the engine while adding multi-user
auth, persistent per-user portfolios, and a polished shadcn/ui dark interface.

This document is the complete specification. It contains every formula, every
threshold, every UI element, and every API route needed to build the app from scratch.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14+ (App Router) |
| Language | TypeScript (strict) |
| UI | shadcn/ui + Tailwind CSS + Radix primitives |
| Auth | NextAuth.js (credentials + OAuth providers) |
| Database | PostgreSQL (via Prisma ORM) |
| Real-time | Server-Sent Events (SSE) from a Next.js route handler |
| Engine | Port the Python engine to TypeScript, OR run the Python engine as a sidecar process and call it via internal API |
| Market data | Alpaca LIVE API (primary) + yfinance via Python sidecar (failsafe) |
| ML | XGBoost model served via Python sidecar; Kronos optional |
| Deployment | Vercel (frontend) + Railway/Fly.io (Python sidecar + Postgres), OR self-hosted Docker Compose |

### Engine strategy (choose one):

**Option A — TypeScript port (recommended for Vercel):** Rewrite engine.py in
TypeScript. The math is all basic arithmetic, sigmoid, bisect, and sorting — no
Python-specific dependencies. This eliminates the sidecar and keeps everything in
one deployable unit. Use `simple-statistics` for mean/stdev and a custom bisect.

**Option B — Python sidecar:** Keep the Python engine as-is, run it as a FastAPI
service alongside Next.js, and call its `/api/scan` endpoint from Next.js server
actions. Simpler to ship (no rewrite) but requires two processes.

This spec assumes Option A (TypeScript port) but the API layer is identical either way.

---

## Design System

### Theme: shadcn/ui dark with zinc

```tsx
// tailwind.config.ts — extend the default shadcn dark theme
// Base: zinc background, neutral text, cyan/green/amber/red accents

const colors = {
  background: "hsl(240 10% 3.9%)",     // zinc-950: #09090b
  foreground: "hsl(0 0% 80%)",          // neutral-300ish: #c7cdd5
  card: "hsl(240 6% 6%)",              // slightly lighter than bg: #0e0f12
  "card-foreground": "hsl(0 0% 80%)",
  popover: "hsl(240 6% 6%)",
  "popover-foreground": "hsl(0 0% 80%)",
  primary: "hsl(168 72% 55%)",          // cyan accent: #36E2C6
  "primary-foreground": "hsl(240 10% 4%)",
  secondary: "hsl(240 5% 12%)",         // zinc-800ish
  "secondary-foreground": "hsl(0 0% 80%)",
  muted: "hsl(240 4% 16%)",
  "muted-foreground": "hsl(240 5% 45%)",
  accent: "hsl(240 5% 15%)",
  "accent-foreground": "hsl(0 0% 80%)",
  destructive: "hsl(350 70% 55%)",      // red: #E2566B
  border: "hsl(240 5% 12%)",
  input: "hsl(240 5% 12%)",
  ring: "hsl(168 72% 55%)",
};
```

### Accent palette (used for data visualization and status)

| Name | Hex | Usage |
|---|---|---|
| cyan | #36E2C6 | BUY signal, primary accent, positive gate, LED ok |
| green | #4ADE80 | P&L positive, target price, portfolio value up, ML agreement |
| amber | #E6B23C | WAIT signal, warnings, yfinance source badge |
| red | #E2566B | SELL signal, stop loss, P&L negative, errors |
| orange | #E6924C | SELL decision on held positions |
| violet | #9385EC | Primary role badge, horizon display |
| blue | #4F9DF0 | HOLD decision, secondary role |
| gold | #FFD700 | Star picks |

### Typography

- Font: `font-mono` throughout (JetBrains Mono / Fira Code / system monospace)
- All-caps micro-labels: `text-[10px] tracking-widest uppercase text-muted-foreground`
- Tabular numbers everywhere: `tabular-nums` on all numeric cells
- No serif fonts anywhere

### Component patterns

- Cards: `bg-card border border-border rounded-md` with subtle grid background on the page body
- Tables: `@shadcn/ui DataTable` with sticky headers, row hover `bg-accent/50`, click-to-expand
- Badges: small pill with border, colored by role/source/decision (see accent palette)
- Mini-bars (M/Q/L/R): 22px wide, 9px tall, colored fill proportional to 0–100 score
- Gate bar: 190px track with teal fill (model edge), white cost wall, green/red net segment
- Status LEDs: 8px circles with glow shadow, colored by health state
- Modals: shadcn `Dialog` for add-to-portfolio, confirm-remove
- Toasts: shadcn `Sonner` for action confirmations

---

## Database Schema (Prisma)

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  passwordHash  String?             // for credentials auth
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  accounts      Account[]           // OAuth accounts (NextAuth)
  sessions      Session[]
  portfolio     PortfolioEntry[]
  settings      UserSettings?
}

model Account {
  // Standard NextAuth account model
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model PortfolioEntry {
  id         String   @id @default(cuid())
  userId     String
  symbol     String
  qty        Float
  costBasis  Float              // per-share cost basis
  notes      String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, symbol])    // one entry per symbol per user
}

model UserSettings {
  id             String  @id @default(cuid())
  userId         String  @unique
  horizon        String  @default("3d")
  universe       String  @default("auto")
  maxSymbols     Int     @default(300)
  alpacaKey      String? // encrypted; per-user API keys (optional)
  alpacaSecret   String? // encrypted
  alpacaFeed     String  @default("iex")
  user           User    @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

---

## Pages & Routes

### Public
| Route | Page | Description |
|---|---|---|
| `/` | Landing | Marketing page: what is Singularity, feature highlights, CTA to sign up |
| `/login` | Auth | Email/password + OAuth login (shadcn form + NextAuth) |
| `/register` | Auth | Account creation |

### Authenticated (dashboard layout with sidebar)
| Route | Page | Description |
|---|---|---|
| `/dashboard` | Scanner | The main scanner table (replaces the old `/` HTML dashboard) |
| `/portfolio` | Portfolio | User's positions with P&L, stop/target, HOLD/SELL signals |
| `/settings` | Settings | Horizon, universe, Alpaca keys, scan cadence |
| `/pipeline` | Reference | Rendered PIPELINE.md — how the engine works |

### API Routes (Next.js Route Handlers)
| Method | Route | Description |
|---|---|---|
| GET | `/api/scan` | Latest scan payload (JSON) — shared across all users |
| GET | `/api/scan/stream` | SSE stream of scan updates |
| GET | `/api/status` | Data source health |
| GET | `/api/portfolio` | Current user's portfolio entries |
| POST | `/api/portfolio` | Add/update a position `{symbol, qty, costBasis}` |
| DELETE | `/api/portfolio/[symbol]` | Remove a position |
| PUT | `/api/portfolio/[symbol]` | Update qty/costBasis/notes |
| GET | `/api/settings` | Current user's settings |
| PUT | `/api/settings` | Update settings |

---

## Scanner Engine (TypeScript Port)

The engine runs as a server-side singleton (or Python sidecar). It is NOT per-user —
one scan loop serves all users. Per-user data (portfolio positions) is overlaid at
read time when building each user's view.

### Architecture

```
[Scan Loop (server singleton)]
  │  runs every N seconds (horizon-dependent cadence)
  │  pulls Alpaca snapshots + daily bars + yfinance failsafe
  │  scores all symbols through the 7-step pipeline
  │  publishes results to an in-memory store
  │
  ├── GET /api/scan → returns latest scan payload
  ├── GET /api/scan/stream → SSE pushes on each cycle
  │
  └── Per-user portfolio overlay:
      when a user requests /portfolio, their DB positions are
      merged with the latest scan rows to compute HOLD/SELL
      decisions, stop/target anchored to THEIR cost basis
```

### Complete Formula Reference

Port these exactly. Every function maps 1:1 from Python to TypeScript.

#### Horizon Calibration

```typescript
function parseHorizon(s: string): number {
  // "5m"->5, "1h"->60, "3d"->1170 (trading minutes)
  s = s.trim().toLowerCase();
  if (s.endsWith("m")) return Math.max(1, parseFloat(s));
  if (s.endsWith("h")) return Math.max(1, parseFloat(s) * 60);
  if (s.endsWith("d")) return Math.max(1, parseFloat(s) * 6.5 * 60);
  return 1170; // default 3d
}

function lerp(t: number, short: number, long: number): number {
  return short + t * (long - short);
}

function calibrateForHorizon(horizonMin: number): GateConfig {
  const T_MIN = 5, T_MAX = 8190;
  const h = Math.max(T_MIN, Math.min(T_MAX, horizonMin));
  const t = Math.log(h / T_MIN) / Math.log(T_MAX / T_MIN);
  return {
    edgeHorizonMinutes: horizonMin,
    frictionPrimary:      round(lerp(t, 0.28, 0.55), 3),
    frictionSecondary:    round(lerp(t, 0.23, 0.48), 3),
    frictionRetained:     round(lerp(t, 0.18, 0.40), 3),
    exitReserveFraction:  round(lerp(t, 1.00, 0.45), 3),
    sessionMultExtended:  round(lerp(t, 1.50, 1.05), 3),
    sessionMultClosed:    round(lerp(t, 2.00, 1.10), 3),
    wMomentum:            round(lerp(t, 0.45, 0.25), 3),
    wQuality:             round(lerp(t, 0.10, 0.40), 3),
    wLiquidity:           round(lerp(t, 0.30, 0.05), 3),
    wRisk:                round(lerp(t, 0.15, 0.30), 3),
    holdingDays:          round(Math.max(h / (6.5 * 60), 0.005), 4),
    stopAtrMult:          round(lerp(t, 0.8, 3.0), 2),
    maxStopPct:           round(lerp(t, 0.02, 0.25), 3),
    // Fixed (horizon-independent):
    edgePrimaryBps: 460, edgeSecondaryBps: 348, edgeRetainedBps: 200,
    evidenceThresholdBps: 95, evidenceScaleBpsPerPt: 8,
    memberPupMin: 0.50, primaryBandBps: 120, retainFloorBps: 40,
    minHurdleBps: 0, operationalRiskBps: 5, cashWaitingValueBps: 0,
    sessionMultRegular: 1.00, minRiskReward: 2.0,
    frictionFloor: 0.05, frictionCeiling: 1.00, convictionGamma: 1.0,
  };
}
```

#### Percentile Rank (O(log N) via binary search)

```typescript
function percentileRank(value: number, sortedVals: number[]): number {
  const n = sortedVals.length;
  if (n <= 1) return 50.0;
  // bisectLeft: count of values strictly less than `value`
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; sortedVals[mid] < value ? lo = mid + 1 : hi = mid; }
  const left = lo;
  // bisectRight: count of values ≤ `value`
  lo = left; hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; sortedVals[mid] <= value ? lo = mid + 1 : hi = mid; }
  const right = lo;
  const eq = right - left;
  return 100.0 * (left + 0.5 * eq) / n;
}
```

#### Signal Families (0–100 each)

**Momentum**: mean percentile of [ret_21d, ret_63d, ret_126d, trend_slope,
dist_sma50 (price/SMA50−1), breakout (price/high_60d), accel (ret_21d−ret_prev_21d),
rel_volume (day_vol/avg_20d)].

**Quality**: mean percentile of [revenue_growth, earnings_growth, profit_margin,
roe, 100−percentile(debt_to_equity), 100−percentile(forward_pe)].
has_fundamentals = true if ≥2 quality components have data.

**Liquidity**: mean of [100−spread_bps (clamped 0–100), percentile(bar_dollar_vol),
50+25×log₁₀(rel_volume) (clamped 0–100)].

**Risk** (higher=safer): mean of [100−percentile(realized_vol), 100−percentile(|beta|),
100+max_drawdown_60d×200 (clamped 0–100; drawdown is negative)].

#### Forecast

```
composite = wM×Momentum + wQ×Quality + wL×Liquidity + wR×Risk     // 0–100
P_up = sigmoid((composite − 50) / 18)
horizon_frac = edgeHorizonMinutes / (60 × 6.5 × 252)
cond_upside = vol_annual × √horizon_frac × 10000                  // bps
pos_edge = max(P_up − 0.5, 0) × cond_upside
μ = confidence × pos_edge
evidence = confidence × max(composite − 50, 0) × 8.0
```

#### Confidence (horizon-adaptive)

```
t = log(max(horizon, 5) / 5) / log(8190 / 5)    // same log-scale as calibration

q = 1.0
if source unknown:     q *= lerp(t, 0.70, 0.90)
if stale quote:        q *= clamp(1 − (age − thresh) / ramp, floor, 1)
                       where thresh=lerp(t,8,600), ramp=lerp(t,60,7200), floor=lerp(t,0.40,0.85)
if no fundamentals:    q *= lerp(t, 0.92, 0.55)
if wide spread:        q *= clamp(1 − (spread − thresh) / ramp, floor, 1)
                       where thresh=lerp(t,15,200), ramp=lerp(t,100,800), floor=lerp(t,0.40,0.75)
per missing field:     q *= clamp(1 − 0.04 × count, 0.6, 1)
family disagreement:   q *= clamp(1 − (max−min−40) / 200, 0.7, 1)
clamp q to [0.05, 1.0]
```

#### ML Integration (XGBoost evidence boost)

```
if ml_score > 50:
    evidence *= 1.0 + (ml_score − 50) / 50 × 0.4    // up to +40% at score=100

if kronos_p_up > 0.5 AND p_up > 0.5:     // directional agreement
    confidence *= 1.15; evidence *= 1.10
elif kronos_p_up < 0.5 AND p_up > 0.5:   // disagreement
    confidence *= 0.85
```

#### Role Assignment

- evidence ≥ 95 AND P_up ≥ 0.50 AND within 120 bps of max → **primary**
- evidence ≥ 95 AND P_up ≥ 0.50 → **secondary**
- held AND evidence ≥ 40 → **retained**
- else → **none**

#### After-Cost Gate (BUY side — non-held)

```
model_edge = role_edge × friction_mult        // e.g., 460 × 0.479 = 220.3 bps

spread_cost = min(1000, spread_bps)
vol_cost = 100 × vol_pct_per_bar
size_ratio = notional / bar_dollar_volume
C_liq = min(120, 0.25 + 9 × √min(9, size_ratio))
C_stale = ramp(quote_age)
C_gap = clamp((gap_days − 1) × 1.75, 0, 25)
C_side = (0.5×spread + 0.10×min(200,vol) + C_liq + C_stale) × session_mult + C_gap

C_entry = C_side
C_exit = 0.65 × C_side × exit_reserve
C_queue = min(60, 0.8 + 12×size_ratio + 4.5×max(0, session−1))
required = max(min_hurdle, C_entry + C_exit + C_queue + operational_risk)

net_surplus = model_edge − cash_wait − required
BUY if net > 0; WAIT if member but net ≤ 0; HOLD-CASH if none
```

#### Sell Triggers (held positions)

```
if price ≤ stop_price         → SELL (stop loss)
if price ≥ target_price       → SELL (target reached)
if composite < 38             → SELL (bearish reversal)
if composite < 45 AND none    → SELL (signal deteriorated)
if member                     → HOLD (strong signal)
if retained                   → HOLD (above churn floor)
if composite ≥ 48             → HOLD (neutral)
else                          → HOLD (review)
```

#### Stop-Loss and Target Price

```
daily_vol = vol_annual / √252
ATR = daily_vol × ref_price × √holding_days       // ref = cost_basis for held, price for new
stop = ref − clamp(stop_atr_mult × ATR, ref×0.01, ref×max_stop_pct)
target_move = 1.5 × daily_vol × √holding_days × conviction_scale × confidence
target = max(ref × (1 + target_move), ref + min_rr × (ref − stop))
R:R = max((target − price) / (price − stop), min_rr)
```

#### Star Score (top 5 BUYs)

```
target_up_pct = (target − price) / price × 100
risk_factor = max(risk_score, 20) / 50
star_score = net_surplus × confidence × risk_factor × (1 + target_up_pct / 20)
→ top 5 by star_score get star = true
```

---

## Component Tree

```
app/
├── layout.tsx                    # Root: font, theme provider, session provider
├── page.tsx                      # Landing page (public)
├── login/page.tsx
├── register/page.tsx
├── (dashboard)/                  # Authenticated layout group
│   ├── layout.tsx                # Sidebar nav + top bar + SSE connection
│   ├── dashboard/page.tsx        # Scanner view
│   ├── portfolio/page.tsx        # Portfolio view
│   ├── settings/page.tsx         # User settings
│   └── pipeline/page.tsx         # Reference docs
├── api/
│   ├── auth/[...nextauth]/route.ts
│   ├── scan/route.ts             # GET: latest scan JSON
│   ├── scan/stream/route.ts      # GET: SSE stream
│   ├── status/route.ts
│   ├── portfolio/route.ts        # GET, POST
│   └── portfolio/[symbol]/route.ts  # PUT, DELETE
└── components/
    ├── scanner/
    │   ├── ScannerTable.tsx       # Main data table with expandable rows
    │   ├── ScanRow.tsx            # Single row: symbol, scores, gate bar, decision
    │   ├── ScanRowDetail.tsx      # Expanded: gate waterfall + signal detail
    │   ├── GateBar.tsx            # The signature after-cost gate visualization
    │   ├── FamilyBars.tsx         # Mini M/Q/L/R score bars
    │   ├── DecisionBadge.tsx      # BUY/SELL/WAIT/HOLD colored badge
    │   ├── RoleBadge.tsx          # primary/secondary/retained/none
    │   ├── SourceBadge.tsx        # ALP/YF/DC source indicator
    │   └── StarBadge.tsx          # Gold star icon for top picks
    ├── portfolio/
    │   ├── PortfolioTable.tsx     # Positions table with P&L + levels
    │   ├── PortfolioRow.tsx       # Single position row
    │   ├── AddPositionDialog.tsx  # Modal: shares + cost basis input
    │   └── PortfolioSummary.tsx   # Totals bar: value, P&L $, P&L %
    ├── dashboard/
    │   ├── StatusRail.tsx         # Feed health, source counts, cycle time
    │   ├── RegimeStrip.tsx        # Decision count chips + star count
    │   ├── FilterBar.tsx          # All/Actionable/Members/Portfolio tabs + search
    │   └── ScanProgress.tsx       # Animated scan line (CSS sweep)
    ├── layout/
    │   ├── Sidebar.tsx            # Nav: Scanner, Portfolio, Settings, Docs
    │   ├── TopBar.tsx             # User avatar, horizon display, logout
    │   └── ThemeProvider.tsx
    └── ui/                        # shadcn/ui primitives (auto-generated)
        ├── button.tsx
        ├── card.tsx
        ├── dialog.tsx
        ├── table.tsx
        ├── badge.tsx
        ├── input.tsx
        ├── select.tsx
        ├── tabs.tsx
        ├── tooltip.tsx
        ├── sonner.tsx
        └── ...
```

---

## Scanner Table Columns

### Main view (scanner/dashboard)

| # | Column | Width | Alignment | Content |
|---|---|---|---|---|
| 1 | # | 40px | left | Row rank |
| 2 | Symbol | 120px | left | ★ (if star) + ticker + source badge (ALP/YF/DC) |
| 3 | Price | 80px | right | $xxx.xx |
| 4 | Spread | 60px | right | xx.x bps |
| 5 | Rel Vol | 60px | right | x.xx× |
| 6 | M·Q·L·R | 120px | left | Four colored mini-bars, 22px each |
| 7 | Conf | 50px | right | 0.xx |
| 8 | μ bps | 55px | right | Expected edge |
| 9 | Evid | 55px | right | Evidence bps (dim if <95, bright if ≥95) |
| 10 | ML | 45px | right | XGBoost score 0–100 (green if ≥60, dim if <40) |
| 11 | Role | 80px | left | Colored badge: primary/secondary/retained/none |
| 12 | Gate | 260px | left | GateBar component + net surplus number |
| 13 | Decision | 90px | right | Colored badge: BUY/SELL/WAIT/HOLD/HOLD-CASH |
| 14 | Action | 70px | left | "+ add" or "+ more" button |

### Portfolio view

| # | Column | Content |
|---|---|---|
| 1 | # | Row number |
| 2 | Symbol | Ticker + source badge |
| 3 | Shares | Position size |
| 4 | Cost Basis | Per-share entry price |
| 5 | Current Price | Live price |
| 6 | P&L $ | (current − cost) × qty, colored green/red |
| 7 | P&L % | Percentage return, colored green/red |
| 8 | Stop Loss | Red, with "x.x%↓" proximity warning if within 3% |
| 9 | Target | Green |
| 10 | R:R | Risk:reward ratio |
| 11 | M·Q·L·R | Family mini-bars |
| 12 | Decision | HOLD/SELL badge with reason on hover |
| 13 | Action | "remove" button |

### Expanded row detail (click to toggle)

Two-column grid inside a collapsible `<tr>`:

**Left column — Gate Waterfall:**
```
role edge · primary                460 bps
× friction                         × 0.479
= model edge                       220.3 bps
− cash wait                        −0.0
− entry cost                       −15.2
− reserved exit                    −7.1
− queue risk                       −3.8
─────────────────────────────────────────
net surplus                        +194.2 bps
```

**Right column — Signal & State:**
```
composite     65.3        P(up)      0.72
momentum      71.2        quality    68.4
liquidity     55.1        risk       62.0
quote age     3.2s        spread     4.8 bps
notional      $12,500     held       — / 100 sh
data          alpaca      gaps       clean
stop          $142.30     target     $178.50
R:R           2.4×
ML P(move)    72%
Kronos P(up)  68% (+3.2%)
star score    485.2
```

---

## Real-Time Data Flow

```
[Scan Loop (server singleton, runs in a background worker)]
    │
    │ every N seconds (horizon-dependent):
    │   1. Fetch Alpaca snapshots (batched, 200/call)
    │   2. Fetch daily bars (cached, refreshed hourly)
    │   3. yfinance failsafe for missing prices
    │   4. Run XGBoost predictions
    │   5. Run engine: score → forecast → roles → gate → levels → stars
    │   6. Store result in server-side cache (in-memory or Redis)
    │   7. Push to all SSE subscribers
    │
    ├── GET /api/scan
    │     → return cached scan result (no portfolio overlay)
    │
    ├── GET /api/scan/stream
    │     → SSE: push scan result on each cycle + keepalive every 20s
    │
    └── Client (Next.js pages):
          → connect to SSE on mount
          → on each event: merge with user's portfolio from DB
          → recompute per-user HOLD/SELL decisions (stop/target anchored to their cost basis)
          → re-render table
```

### Portfolio overlay (client-side)

The scan result is shared (same for all users). Per-user portfolio overlay happens
client-side: for each portfolio entry, find the matching scan row and:
1. Set `held_qty` and `held_notional` from the user's DB entry
2. Recompute `stop_price` and `target_price` using the user's `cost_basis` as `ref_price`
3. Re-evaluate the sell triggers (stop breach, target reached, composite thresholds)
4. Display the user's P&L = (current_price − cost_basis) × qty

This keeps the server scan loop stateless and per-user state in the DB.

---

## Authentication

Use NextAuth.js with:
- **Credentials provider**: email + bcrypt-hashed password
- **Google OAuth** (optional, easy to add)
- **GitHub OAuth** (optional)

Session strategy: JWT (stateless, works on Vercel edge).

Protected routes: everything under `/(dashboard)/` requires authentication.
Redirect unauthenticated users to `/login`.

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/singularity

# NextAuth
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000

# Alpaca (shared/default — users can override in settings)
ALPACA_API_KEY=
ALPACA_API_SECRET=
ALPACA_FEED=iex

# Scanner
SCANNER_HORIZON=3d
SCANNER_UNIVERSE=auto
SCANNER_MAX_SYMBOLS=300
SCANNER_INTERVAL_S=0           # 0 = auto from horizon
SCANNER_MOCK=false

# ML
SCANNER_USE_XGBOOST=true
SCANNER_USE_KRONOS=false
KRONOS_PATH=                   # path to cloned Kronos repo (if using)

# OAuth (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

---

## Implementation Notes

### Performance

- The scan loop runs server-side as a singleton. On Vercel, use a separate
  long-running worker (Railway/Fly) since Vercel functions are short-lived.
  Self-hosted: run as a background task in the Next.js server process.
- SSE connections are lightweight. Each client holds one open connection.
- The scan payload is ~50–200KB for 300 symbols. For 6000+ symbols, consider
  pagination or only sending the top N rows + any portfolio-held symbols.
- XGBoost prediction for 6000 symbols takes <10ms (it's just matrix multiply).

### Security

- Alpaca API keys stored in the DB should be encrypted at rest (use
  `crypto.createCipheriv` with a server-side key from env).
- Never expose Alpaca keys to the client. All market-data calls happen server-side.
- Rate-limit the portfolio API (5 writes/minute per user).
- CSRF protection via NextAuth's built-in handling.

### Error Handling

- If Alpaca is down, the scan loop logs the error and retries with adaptive backoff.
- If yfinance failsafe also fails, symbols show as NO-DATA (not hidden).
- If the XGBoost model isn't trained, the ML column shows "–" gracefully.
- All API routes return structured error JSON: `{ error: string, code: number }`.

### Testing

- Unit tests for every engine function (percentileRank, sigmoid, forecast,
  evaluateGate, computeLevels, calibrateForHorizon) with the same test vectors
  used in the Python version.
- Integration test: mock Alpaca data → run full scan → verify BUY/SELL decisions.
- E2E: Playwright tests for login → add to portfolio → verify P&L display.

---

## Migration Path

1. Set up Next.js + Prisma + NextAuth + shadcn/ui scaffold
2. Port engine.py → lib/engine.ts (pure functions, no side effects)
3. Port data.py → lib/data.ts (Alpaca client, yfinance sidecar calls)
4. Build scan loop as a server-side singleton with SSE push
5. Build the scanner table UI (the core experience)
6. Add auth (NextAuth + credentials)
7. Add portfolio CRUD (DB + API + UI)
8. Add portfolio overlay (client-side merge with scan data)
9. Add settings page (horizon picker, universe, keys)
10. Add ML integration (XGBoost via Python sidecar or ONNX runtime)
11. Polish: loading states, error boundaries, mobile responsive, PWA
