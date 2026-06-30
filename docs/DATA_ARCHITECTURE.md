# Singularity Scanner — Data Architecture

How the scanner gets its data without hitting rate limits.

---

## Source split

| Data | Source | Call method | Refresh rate |
|---|---|---|---|
| Live price, bid, ask | **Alpaca** snapshots | batched, 200 symbols/request | every scan cycle |
| Quote age, spread | **Alpaca** snapshots | batched | every scan cycle |
| Day volume, avg 20d volume | **Alpaca** snapshots + daily bars | batched | snapshots: every cycle; bars: hourly |
| Daily closes (1y history) | **Alpaca** bars → **yfinance** fallback | Alpaca batched 200/req; yfinance `yf.download()` batched 200/req | hourly, cached to disk |
| SPY closes (for beta) | **Alpaca** bars → **yfinance** fallback | single call | hourly |
| Revenue growth | **yfinance** `Ticker.get_info()` → `income_stmt` fallback | individual, throttled | every 6 hours |
| Earnings growth | **yfinance** `Ticker.get_info()` → `income_stmt` fallback | individual, throttled | every 6 hours |
| Profit margin | **yfinance** `Ticker.get_info()` | individual, throttled | every 6 hours |
| ROE | **yfinance** `Ticker.get_info()` | individual, throttled | every 6 hours |
| Debt-to-equity | **yfinance** `Ticker.get_info()` | individual, throttled | every 6 hours |
| Forward P/E | **yfinance** `Ticker.get_info()` | individual, throttled | every 6 hours |
| Market clock (open/close) | **Alpaca** `/v2/clock` | single call | every scan cycle |
| Universe symbols | **Alpaca** `/v2/assets` | single call | once at startup, cached 24h |

Alpaca provides **nothing** for fundamentals. Every quality-family metric (revenue growth, earnings growth, margin, ROE, D/E, PE) comes from yfinance.

---

## Why yfinance returns 429s

yfinance is an unofficial scraper — it pulls from Yahoo Finance's public web endpoints. Yahoo aggressively rate-limits:

- **~2,000 requests/hour** per IP (approximate, varies)
- **Per-ticker calls are expensive**: `yf.Ticker("AAPL").history()` = 1 HTTP request per symbol
- **7,940 symbols × per-ticker = 7,940 requests** → immediate 429 block

A naive loop like this will fail on any universe above ~200 symbols:

```python
# BAD: 7,940 HTTP requests
for sym in universe:
    h = yf.Ticker(sym).history(period="1y")
    info = yf.Ticker(sym).get_info()
    # → 429 Too Many Requests after ~500 symbols
```

---

## How this scanner avoids 429s

### 1. Alpaca handles the hot path

Live prices, quotes, and daily bars all come from Alpaca first. Alpaca has proper API rate limits (200 requests/minute on the free tier) and batched endpoints that return 200 symbols per call. The scan loop never touches yfinance for price data unless Alpaca fails.

### 2. Batched yfinance downloads for daily bars

When Alpaca doesn't cover a symbol (or fails), the scanner uses `yf.download()` — **not** `yf.Ticker().history()`. The difference:

```python
# BAD: 1 HTTP request per symbol
for sym in symbols:
    yf.Ticker(sym).history(period="1y")       # 6000 calls

# GOOD: 1 HTTP request per 200 symbols
for chunk in chunks(symbols, 200):
    yf.download(tickers=" ".join(chunk),       # 30 calls for 6000 symbols
                period="1y", group_by="ticker",
                threads=True, progress=False)
```

`yf.download()` with multiple tickers sends a single HTTP request that returns all of them. 6,000 symbols in chunks of 200 = **30 requests** instead of 6,000.

### 3. Fallback cap

If more than 800 symbols need yfinance backfill (meaning Alpaca is substantially down), the scanner caps at 800 and logs a warning. This prevents runaway yfinance traffic.

```
SCANNER_YF_FALLBACK_MAX=800
```

### 4. Throttled fundamentals

Fundamentals **cannot** be batched — `yf.Ticker(sym).get_info()` is always a per-symbol call. The scanner mitigates this with:

- **50ms delay** between calls (`asyncio.sleep(0.05)`) → max 20 calls/second
- **6-hour refresh interval** — fundamentals are fetched once at startup, then cached for 6 hours
- **Disk cache** — results are saved to `.cache/fundamentals.json` and survive restarts

At 20 calls/second, 7,940 symbols takes ~6.5 minutes. This stays well under Yahoo's rate limits because it's sustained, not bursty.

### 5. Disk caching across restarts

Three caches persist to disk:

| Cache file | Contents | TTL |
|---|---|---|
| `.cache/universe.json` | Symbol list from Alpaca | 24 hours |
| `.cache/fundamentals.json` | All yfinance fundamental data | 6 hours |
| `.cache/daily_features.json` | Computed daily features (returns, vol, beta, etc.) | 1 hour |

If you restart the scanner within the TTL, it loads from cache and skips the network calls entirely. This means you can restart freely without re-triggering 7,940 yfinance calls.

---

## Request budget per cycle

For a 7,940-symbol universe on a typical scan cycle:

| Call | Count | Source | Notes |
|---|---|---|---|
| Snapshots | ~40 | Alpaca | 200 symbols/request |
| Daily bars | 0 | cache | only refreshes hourly |
| Fundamentals | 0 | cache | only refreshes every 6h |
| yfinance recent prices | 0–10 | yfinance | only for symbols Alpaca missed, capped |
| Clock | 1 | Alpaca | |
| **Total** | **~41** | | **per cycle** |

During the hourly daily-bar refresh, add ~40 Alpaca bar requests (batched). During the 6-hourly fundamentals refresh, add ~7,940 throttled yfinance calls spread over 6.5 minutes.

---

## Configuration

```env
# Max symbols to backfill from yfinance when Alpaca misses them
SCANNER_YF_FALLBACK_MAX=800

# How often daily bars are re-fetched (seconds)
SCANNER_DAILY_REFRESH_S=3600         # 1 hour

# How often fundamentals are re-fetched (seconds)  
SCANNER_FUNDA_REFRESH_S=21600       # 6 hours

# Enable/disable yfinance fundamentals entirely
SCANNER_YF_FUNDAMENTALS=true

# Cache directory
SCANNER_CACHE_DIR=.cache
```

---

## If you're still getting 429s

1. **Check your fundamentals refresh interval** — if it's less than 1 hour for a large universe, Yahoo will block you.

2. **Add a delay between per-ticker calls** — 50ms minimum, 100ms if you're on a shared IP or VPN.

3. **Use `yf.download()` for any batch operation** — never loop `yf.Ticker().history()` across hundreds of symbols.

4. **Cache aggressively** — fundamentals don't change intraday. Daily bars don't need to refresh more than once an hour. Save to disk, load on restart.

5. **Cap your fallback volume** — if Alpaca covers 95% of your universe, don't let the other 5% cause 400 yfinance calls every cycle.
