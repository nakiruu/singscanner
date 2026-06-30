# Singularity Scanner — Next.js Rebuild Spec

## Stack
Next.js 14+ App Router, TypeScript strict, shadcn/ui + Tailwind, NextAuth.js (credentials+OAuth), PostgreSQL via Prisma, SSE for real-time. Port Python engine to TS (all basic math, no Python deps). Market data: Alpaca LIVE API primary, yfinance failsafe via Python sidecar. XGBoost via Python sidecar.

## Theme: shadcn dark, zinc bg, mono font
```
background: hsl(240 10% 3.9%)  // zinc-950 #09090b
foreground: hsl(0 0% 80%)
card: hsl(240 6% 6%)           // #0e0f12
primary: hsl(168 72% 55%)      // cyan #36E2C6
destructive: hsl(350 70% 55%)  // red #E2566B
border/input: hsl(240 5% 12%)
ring: hsl(168 72% 55%)
```
Accents: cyan=#36E2C6 (BUY/positive), green=#4ADE80 (P&L+/target/ML), amber=#E6B23C (WAIT/warn), red=#E2566B (SELL/stop/error), orange=#E6924C (held SELL), violet=#9385EC (primary role/horizon), blue=#4F9DF0 (HOLD/secondary), gold=#FFD700 (stars). All text mono, tabular-nums on numbers, uppercase micro-labels 10px tracking-widest.

## DB Schema (Prisma)
```prisma
model User { id String @id @default(cuid()); email String @unique; name String?; passwordHash String?; image String?; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt; accounts Account[]; sessions Session[]; portfolio PortfolioEntry[]; settings UserSettings? }
model Account { id String @id @default(cuid()); userId String; type String; provider String; providerAccountId String; refresh_token String?; access_token String?; expires_at Int?; token_type String?; scope String?; id_token String?; session_state String?; user User @relation(fields:[userId],references:[id],onDelete:Cascade); @@unique([provider,providerAccountId]) }
model Session { id String @id @default(cuid()); sessionToken String @unique; userId String; expires DateTime; user User @relation(fields:[userId],references:[id],onDelete:Cascade) }
model PortfolioEntry { id String @id @default(cuid()); userId String; symbol String; qty Float; costBasis Float; notes String?; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt; user User @relation(fields:[userId],references:[id],onDelete:Cascade); @@unique([userId,symbol]) }
model UserSettings { id String @id @default(cuid()); userId String @unique; horizon String @default("3d"); universe String @default("auto"); maxSymbols Int @default(300); alpacaKey String?; alpacaSecret String?; alpacaFeed String @default("iex"); user User @relation(fields:[userId],references:[id],onDelete:Cascade) }
```

## Routes
Public: `/` landing, `/login`, `/register`. Auth required: `/dashboard` (scanner table), `/portfolio` (user positions+P&L+levels), `/settings` (horizon/universe/keys), `/pipeline` (reference docs).

API: `GET /api/scan` latest JSON, `GET /api/scan/stream` SSE, `GET /api/status`, `GET|POST /api/portfolio`, `PUT|DELETE /api/portfolio/[symbol]`, `GET|PUT /api/settings`.

## Architecture
One shared scan loop (server singleton) serves all users. Per-user portfolio overlay happens client-side: merge shared scan rows with user's DB positions, recompute stop/target from their cost_basis, re-evaluate sell triggers.

## Engine Formulas (port exactly)

### Horizon calibration
`parseHorizon("5m")->5, "1h"->60, "3d"->1170 trading min`. Log-scale interpolation t=log(h/5)/log(8190/5) between 5m and 21d anchors:

| Param | 5m | 21d | Formula |
|---|---|---|---|
| frictionPrimary | 0.28 | 0.55 | lerp(t,0.28,0.55) |
| frictionSecondary | 0.23 | 0.48 | lerp(t,0.23,0.48) |
| frictionRetained | 0.18 | 0.40 | lerp(t,0.18,0.40) |
| exitReserve | 1.00 | 0.45 | lerp(t,1.00,0.45) |
| sessionExtended | 1.50 | 1.05 | lerp(t,1.50,1.05) |
| sessionClosed | 2.00 | 1.10 | lerp(t,2.00,1.10) |
| wMomentum | 0.45 | 0.25 | lerp(t,0.45,0.25) |
| wQuality | 0.10 | 0.40 | lerp(t,0.10,0.40) |
| wLiquidity | 0.30 | 0.05 | lerp(t,0.30,0.05) |
| wRisk | 0.15 | 0.30 | lerp(t,0.15,0.30) |
| stopAtrMult | 0.8 | 3.0 | lerp(t,0.8,3.0) |
| maxStopPct | 0.02 | 0.25 | lerp(t,0.02,0.25) |

Fixed: edgePrimary=460, edgeSecondary=348, edgeRetained=200, evidenceThreshold=95, evidenceScale=8, memberPupMin=0.50, primaryBand=120, retainFloor=40, minHurdle=0, opRisk=5, cashWait=0, sessionRegular=1.0, minRR=2.0, frictionFloor=0.05, frictionCeiling=1.0, gamma=1.0.

### percentileRank(value, sortedVals)
Binary search: lo=bisectLeft, hi=bisectRight, eq=hi-lo, return 100*(lo+0.5*eq)/n. Returns 50 if n≤1.

### Signal families (0-100 each, cross-sectional percentile rank)
**Momentum**: mean pctile of [ret_21d, ret_63d, ret_126d, trend_slope, price/sma50-1, price/high60d, ret21d-retPrev21d, dayVol/avg20dVol].
**Quality**: mean pctile of [revGrowth, earnGrowth, profitMargin, roe, 100-pctile(debtToEquity), 100-pctile(fwdPE)]. has_fundamentals=count≥2.
**Liquidity**: mean of [100-spreadBps (clamp 0-100), pctile(barDollarVol), 50+25*log10(relVol) (clamp 0-100)].
**Risk** (higher=safer): mean of [100-pctile(realizedVol), 100-pctile(|beta|), clamp(100+maxDD60d*200, 0, 100)].

### Forecast
```
composite = wM*M + wQ*Q + wL*L + wR*R
P_up = sigmoid((composite-50)/18)
horizonFrac = edgeHorizonMin / (60*6.5*252)
condUpside = volAnn * sqrt(horizonFrac) * 10000
posEdge = max(P_up-0.5, 0) * condUpside
mu = confidence * posEdge
evidence = confidence * max(composite-50, 0) * 8.0
```

### Confidence (horizon-adaptive, t same as calibration)
q=1.0. Unknown source: q*=lerp(t,0.70,0.90). Stale quote (market open only): q*=clamp(1-(age-thresh)/ramp, floor, 1) where thresh=lerp(t,8,600), ramp=lerp(t,60,7200), floor=lerp(t,0.40,0.85). No fundamentals: q*=lerp(t,0.92,0.55). Wide spread: q*=clamp(1-(spread-thresh)/ramp, floor, 1) where thresh=lerp(t,15,200), ramp=lerp(t,100,800), floor=lerp(t,0.40,0.75). Per missing field: q*=clamp(1-0.04*count, 0.6, 1). Family disagreement: q*=clamp(1-(maxFam-minFam-40)/200, 0.7, 1). Clamp q [0.05, 1.0].

### ML boost
If mlScore>50: evidence*=1+(mlScore-50)/50*0.4. Kronos agree (both p_up>0.5): confidence*=1.15, evidence*=1.10. Kronos disagree: confidence*=0.85.

### Roles
evidence≥95 AND P_up≥0.50: primary (within 120bps of max) or secondary. Held AND evidence≥40: retained. Else: none.

### After-cost gate (BUY side, non-held)
```
modelEdge = roleEdge * frictionMult
sa = min(1000, spreadBps)
va = 100 * volPctPerBar
ua = notional / barDollarVol
C_liq = min(120, 0.25+9*sqrt(min(9,ua)))  // floor 35 if vol missing
C_stale = ramp(quoteAge): ≤8s→0, ≤60s→(age-8)/6 cap 20, >60s→4+(age-60)/10 cap 80
C_gap = clamp((gapDays-1)*1.75, 0, 25)
C_side = (0.5*sa + 0.10*min(200,va) + C_liq + C_stale) * sessionMult + C_gap
C_entry=C_side; C_exit=0.65*C_side*exitReserve; C_queue=min(60, 0.8+12*ua+4.5*max(0,sess-1))
required = max(minHurdle, C_entry+C_exit+C_queue+opRisk)
net = modelEdge - cashWait - required
BUY if net>0; WAIT if member & net≤0; HOLD-CASH if none
```

### Sell triggers (held)
price≤stop→SELL(stop). price≥target→SELL(take profit). composite<38→SELL(reversal). composite<45 AND none→SELL(deteriorated). member→HOLD(strong). retained→HOLD. composite≥48→HOLD(neutral). else→HOLD(review).

### Stop/target (ref=costBasis for held, price for new)
```
dailyVol = volAnn/sqrt(252)
ATR = dailyVol * ref * sqrt(holdingDays)
stop = ref - clamp(stopAtrMult*ATR, ref*0.01, ref*maxStopPct)
targetMove = 1.5*dailyVol*sqrt(holdingDays) * clamp((composite-40)/30, 0.3, 1.2) * clamp(confidence, 0.5, 1.0)
target = max(ref*(1+targetMove), ref+minRR*(ref-stop))
RR = max((target-currentPrice)/(currentPrice-stop), minRR)
```

### Stars (top 5 BUYs)
`starScore = netSurplus * confidence * max(risk,20)/50 * (1+targetUpPct/20)`. Top 5 get star=true, sort first.

## Components
```
(dashboard)/layout.tsx — sidebar nav, topbar, SSE connection
dashboard/page.tsx — ScannerTable (main), StatusRail, RegimeStrip, FilterBar, ScanProgress
portfolio/page.tsx — PortfolioTable, AddPositionDialog, PortfolioSummary
settings/page.tsx — horizon picker, universe, keys
```

### Scanner table cols
#, Symbol(★+ticker+srcBadge), Price, Spread bps, RelVol, M·Q·L·R minibars, Conf, μ bps, Evidence(bright≥95), ML(green≥60), Role badge, GateBar(teal fill=modelEdge, white wall=cost, green/red=net), Decision badge, +add btn.

### Portfolio table cols
#, Symbol, Shares, CostBasis, CurrentPrice, P&L$, P&L%, StopLoss(red, warn<3%), Target(green), R:R, M·Q·L·R, Decision, remove btn.

### GateBar (signature component)
190px track. Teal fill=modelEdge%. White 2px line=required%. Green segment past wall=positive net. Red segment=deficit. Number right: +/- net bps.

### Expanded row detail
Left: gate waterfall (role edge → ×friction → model edge → −entry → −exit → −queue → =net). Right: grid of composite, P_up, M/Q/L/R, quoteAge, spread, notional, held, source, gaps, stop, target, R:R, ML%, Kronos%, starScore.

## Env vars
DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, ALPACA_API_KEY, ALPACA_API_SECRET, ALPACA_FEED=iex, SCANNER_HORIZON=3d, SCANNER_UNIVERSE=auto, SCANNER_MAX_SYMBOLS=300, SCANNER_INTERVAL_S=0, SCANNER_MOCK=false, SCANNER_USE_XGBOOST=true, SCANNER_USE_KRONOS=false, KRONOS_PATH.
