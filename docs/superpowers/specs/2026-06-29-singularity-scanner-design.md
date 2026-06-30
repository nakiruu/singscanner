# Singularity Scanner — Design Spec
_Date: 2026-06-29_

## Overview

Rebuild the Singularity after-cost stock scanner as a full-stack Next.js 14+ application with user accounts, individual portfolios, and real-time scanning. The engine is fully ported to TypeScript (no Python sidecar). Market data comes from the Alpaca LIVE API. Auth is credentials-only (email + bcrypt).

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14+ App Router |
| Language | TypeScript strict |
| UI | shadcn/ui + Tailwind CSS + Radix primitives |
| Auth | NextAuth.js — credentials provider, JWT sessions |
| Database | PostgreSQL via Prisma ORM |
| Real-time | Server-Sent Events (SSE) via Next.js route handler |
| Engine | TypeScript port of all Python formulas (Option A) |
| Market data | Alpaca LIVE API (primary); yfinance Python sidecar as failsafe if needed later |
| ML | XGBoost via Python sidecar (optional, graceful degradation if absent) |

---

## Architecture

```
Next.js App (single monorepo)
├── lib/engine.ts         — pure TS port of all formulas (no I/O, fully unit-testable)
├── lib/data.ts           — Alpaca API client (server-only, never exposed to client)
├── lib/scanLoop.ts       — server singleton: fetch → run engine → store result
├── lib/store.ts          — in-memory scan cache + SSE subscriber broadcaster
├── lib/crypto.ts         — encrypt/decrypt Alpaca keys at rest
└── app/
    ├── api/              — route handlers
    ├── (dashboard)/      — authenticated layout group
    └── components/       — UI components
```

The scan loop starts on server boot via `instrumentation.ts` using `setInterval`. It is user-agnostic — one shared result for all users. Per-user portfolio overlay is computed client-side.

---

## Data Flow

```
Server startup
  → scanLoop: Alpaca snapshots (batched 200/call) + daily bars
  → engine.ts: score → forecast → roles → gate → levels → stars
  → store: cache latest result, broadcast to all SSE subscribers

Browser (authenticated):
  → GET /api/scan/stream (SSE, keepalive every 20s, auto-reconnect)
  → on each event: merge with user's portfolio from GET /api/portfolio
  → recompute stop/target/P&L using user's cost_basis (client-side)
  → re-render ScannerTable and PortfolioTable
```

Portfolio overlay is purely client-side: for each held position, find the matching scan row, recompute `stop_price`/`target_price` with the user's `cost_basis` as `ref_price`, re-evaluate sell triggers, compute P&L = (current_price − cost_basis) × qty.

---

## Engine Functions (TypeScript Port)

All ported 1:1 from the spec. Pure functions, no side effects.

| Function | Description |
|---|---|
| `parseHorizon(s)` | "5m"→5, "1h"→60, "3d"→1170 trading minutes |
| `calibrateForHorizon(min)` | log-scale lerp → GateConfig with 12 horizon-adaptive params |
| `percentileRank(value, sorted)` | O(log N) binary search, returns 50 if n≤1 |
| `scoreMomentum(rows)` | mean pctile of 8 momentum fields |
| `scoreQuality(rows)` | mean pctile of 6 fundamental fields (has_fundamentals if ≥2) |
| `scoreLiquidity(rows)` | spread + bar_dollar_vol + rel_vol |
| `scoreRisk(rows)` | realized_vol + beta + max_drawdown_60d |
| `computeConfidence(row, cfg, t)` | horizon-adaptive quality multipliers, clamped [0.05, 1.0] |
| `computeForecast(row, cfg)` | composite → P_up → μ → evidence |
| `applyMLBoost(row)` | XGBoost evidence boost + Kronos agreement multiplier |
| `assignRole(rows, cfg)` | primary / secondary / retained / none |
| `evaluateGate(row, cfg)` | after-cost net surplus → BUY / WAIT / HOLD-CASH |
| `evaluateSellTriggers(row, cfg)` | stop/target/composite thresholds for held positions |
| `computeLevels(row, cfg, ref)` | stop price, target price, R:R |
| `computeStarScore(row)` | net_surplus × confidence × risk_factor × (1 + target_up_pct/20) |

---

## Database Schema (Prisma)

```prisma
model User {
  id           String          @id @default(cuid())
  email        String          @unique
  name         String?
  passwordHash String?
  image        String?
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt
  accounts     Account[]
  sessions     Session[]
  portfolio    PortfolioEntry[]
  settings     UserSettings?
}

model Account {
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
  id        String   @id @default(cuid())
  userId    String
  symbol    String
  qty       Float
  costBasis Float
  notes     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, symbol])
}

model UserSettings {
  id           String  @id @default(cuid())
  userId       String  @unique
  horizon      String  @default("3d")
  universe     String  @default("auto")
  maxSymbols   Int     @default(300)
  alpacaKey    String?
  alpacaSecret String?
  alpacaFeed   String  @default("iex")
  user         User    @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

---

## Routes

### Public
| Route | Description |
|---|---|
| `/` | Landing page |
| `/login` | Credentials sign-in |
| `/register` | Account creation |

### Authenticated (behind middleware)
| Route | Description |
|---|---|
| `/dashboard` | Scanner table — main experience |
| `/portfolio` | User positions with P&L, stop/target, HOLD/SELL |
| `/settings` | Horizon, universe, Alpaca keys |
| `/pipeline` | Reference docs |

### API
| Method | Route | Description |
|---|---|---|
| GET | `/api/scan` | Latest scan payload (JSON) |
| GET | `/api/scan/stream` | SSE stream, keepalive 20s |
| GET | `/api/status` | Data source health |
| GET | `/api/portfolio` | Current user's positions |
| POST | `/api/portfolio` | Add/update position `{symbol, qty, costBasis}` |
| PUT | `/api/portfolio/[symbol]` | Update qty/costBasis/notes |
| DELETE | `/api/portfolio/[symbol]` | Remove position |
| GET | `/api/settings` | Current user's settings |
| PUT | `/api/settings` | Update settings |

---

## UI Components

### Design tokens
- Background: `hsl(240 10% 3.9%)` (zinc-950)
- Primary/cyan: `#36E2C6` — BUY, positive gate, active state
- Green `#4ADE80` — P&L+, target, ML agreement
- Amber `#E6B23C` — WAIT, warnings
- Red `#E2566B` — SELL, stop loss, errors
- Orange `#E6924C` — SELL on held positions
- Violet `#9385EC` — primary role badge
- Blue `#4F9DF0` — HOLD, secondary role
- Gold `#FFD700` — star picks
- Font: `font-mono` throughout, `tabular-nums` on all numbers
- Micro-labels: `text-[10px] tracking-widest uppercase text-muted-foreground`

### Scanner table columns
`#` · Symbol (★+ticker+badge) · Price · Spread bps · Rel Vol · M·Q·L·R minibars · Conf · μ bps · Evid · ML · Role · **GateBar** · Decision · +add

### GateBar (signature component)
190px track. Teal fill = model edge %. White 2px wall = required cost %. Green segment past wall = positive net. Red segment = deficit. Number right: ±net bps.

### Portfolio table columns
`#` · Symbol · Shares · Cost Basis · Current Price · P&L $ · P&L % · Stop Loss · Target · R:R · M·Q·L·R · Decision · remove

### Expanded row (click-to-toggle `<tr>`)
- **Left:** gate waterfall (role edge → ×friction → model edge → −entry → −exit → −queue → =net)
- **Right:** signal grid (composite, P_up, M/Q/L/R, quote age, spread, notional, held, source, gaps, stop, target, R:R, ML%, Kronos%, starScore)

---

## Auth

- NextAuth.js credentials provider: email + `bcrypt` password hash
- JWT session strategy (works on Vercel edge)
- Middleware at `middleware.ts` protects all `/(dashboard)/*` routes
- Unauthenticated requests redirect to `/login`
- Alpaca keys in `UserSettings` encrypted with `crypto.createCipheriv` (AES-256-GCM), server-side key from env

---

## Security

- Alpaca keys never exposed to the client — all Alpaca calls are server-side
- API routes rate-limited: 5 portfolio writes/minute per user
- CSRF protection via NextAuth built-in handling
- Structured error JSON: `{ error: string, code: number }`

---

## Environment Variables

```env
DATABASE_URL=postgresql://user:pass@host:5432/singularity
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
ALPACA_API_KEY=
ALPACA_API_SECRET=
ALPACA_FEED=iex
SCANNER_HORIZON=3d
SCANNER_UNIVERSE=auto
SCANNER_MAX_SYMBOLS=300
SCANNER_INTERVAL_S=0
SCANNER_MOCK=false
SCANNER_USE_XGBOOST=true
SCANNER_USE_KRONOS=false
ENCRYPTION_KEY=          # 32-byte hex key for AES-256-GCM
```

---

## Build Order

1. Next.js scaffold + Prisma + NextAuth + shadcn/ui
2. Design tokens + global theme (CSS variables, Tailwind config)
3. `lib/engine.ts` — all pure engine functions
4. `lib/data.ts` — Alpaca client
5. `lib/store.ts` + `lib/scanLoop.ts` — server singleton + SSE broadcaster
6. API routes: `/api/scan`, `/api/scan/stream`, `/api/status`
7. Auth pages: `/login`, `/register` + middleware
8. Dashboard page: `ScannerTable`, `GateBar`, `FamilyBars`, `DecisionBadge`, `StatusRail`, `RegimeStrip`, `FilterBar`
9. Portfolio API + `PortfolioTable` page
10. Settings page
11. Landing page + `/pipeline` reference page
12. Unit tests for all engine functions
