"""Fundamentals sidecar — direct Yahoo Finance quoteSummary client.

Anonymous Yahoo quoteSummary calls require a cookie+crumb authentication
handshake. Without it, Yahoo returns 429 on every single request.

Handshake:
  1. GET https://fc.yahoo.com (or https://finance.yahoo.com) — sets A1/A3 cookies
  2. GET https://query2.finance.yahoo.com/v1/test/getcrumb with those cookies
     returns a short crumb string
  3. All subsequent quoteSummary calls include `&crumb=<crumb>` in the URL

The crumb stays valid until the cookies expire (~1 hour, observed). We refresh
on 401/429 responses and on a periodic timer.

If Yahoo continues blocking even with a valid crumb, the Unraid host IP is
flagged. In that case switch to a real fundamentals API with a key (FMP,
Finnhub, Polygon) — see the README.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

log = logging.getLogger("fund")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

YAHOO_BASE = "https://query1.finance.yahoo.com/v10/finance/quoteSummary"
YAHOO_COOKIE_URL = "https://fc.yahoo.com"
YAHOO_CRUMB_URL = "https://query2.finance.yahoo.com/v1/test/getcrumb"
MODULES = "financialData,defaultKeyStatistics,summaryDetail"

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
HTTP_TIMEOUT_S = 10.0
CACHE_TTL_S = 24 * 3600       # 24h cache for successful fetches
NEG_CACHE_TTL_S = 15 * 60     # 15min for failures — don't hammer Yahoo
CRUMB_TTL_S = 30 * 60         # refresh crumb every 30 min proactively
MAX_CONCURRENT = 3            # Yahoo is rate-aware; keep this LOW

# symbol -> (cache_ts, row_dict_or_None)
_cache: dict[str, tuple[float, Optional[dict]]] = {}
_cache_lock = asyncio.Lock()
_sem: Optional[asyncio.Semaphore] = None
_client: Optional[httpx.AsyncClient] = None
_started_at: float = 0.0

_crumb: Optional[str] = None
_crumb_ts: float = 0.0
_crumb_lock = asyncio.Lock()


async def _refresh_crumb() -> bool:
    """Run the cookie+crumb handshake. Returns True if we have a usable crumb."""
    global _crumb, _crumb_ts
    assert _client is not None
    try:
        # Step 1: hit Yahoo for cookies. The actual response body doesn't matter,
        # we want the Set-Cookie. fc.yahoo.com is dedicated for this; if it fails
        # fall back to finance.yahoo.com which also sets the A1/A3 cookies.
        try:
            await _client.get(YAHOO_COOKIE_URL)
        except httpx.HTTPError:
            await _client.get("https://finance.yahoo.com")

        # Step 2: pull a crumb. Comes back as a plain text body.
        res = await _client.get(YAHOO_CRUMB_URL)
        if res.status_code != 200 or not res.text or len(res.text) > 50:
            log.warning("crumb fetch failed: status=%s body=%r", res.status_code, res.text[:80])
            return False
        crumb = res.text.strip()
        if not crumb or "<" in crumb:  # got HTML, not a crumb
            log.warning("crumb body looks wrong: %r", crumb[:80])
            return False
        _crumb = crumb
        _crumb_ts = time.time()
        log.info("crumb refreshed: %r (len=%d)", crumb[:10] + "…", len(crumb))
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("crumb refresh exception: %s", e)
        return False


async def _ensure_crumb() -> Optional[str]:
    """Return a usable crumb, refreshing if stale or missing. Lock-protected."""
    global _crumb
    async with _crumb_lock:
        if _crumb is not None and time.time() - _crumb_ts < CRUMB_TTL_S:
            return _crumb
        ok = await _refresh_crumb()
        return _crumb if ok else None


async def _invalidate_crumb() -> None:
    global _crumb
    async with _crumb_lock:
        _crumb = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _sem, _client, _started_at
    _started_at = time.time()
    _sem = asyncio.Semaphore(MAX_CONCURRENT)
    _client = httpx.AsyncClient(
        timeout=httpx.Timeout(HTTP_TIMEOUT_S),
        headers={
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": "https://finance.yahoo.com",
            "Referer": "https://finance.yahoo.com/",
        },
        follow_redirects=True,
    )
    log.info("fundamentals sidecar booted")
    # Warm the crumb once at startup — failures aren't fatal, will retry on demand.
    await _refresh_crumb()
    try:
        yield
    finally:
        if _client is not None:
            await _client.aclose()


app = FastAPI(title="singscanner-fundamentals", lifespan=lifespan)


class SymbolList(BaseModel):
    symbols: list[str]


class FundamentalRow(BaseModel):
    symbol: str
    revenue_growth: Optional[float] = None
    earnings_growth: Optional[float] = None
    profit_margin: Optional[float] = None
    roe: Optional[float] = None
    debt_to_equity: Optional[float] = None
    forward_pe: Optional[float] = None


class FundamentalsResponse(BaseModel):
    rows: list[FundamentalRow]
    skipped: list[str]


def _g(d: Optional[dict], key: str) -> Optional[float]:
    if not isinstance(d, dict):
        return None
    v = d.get(key)
    if isinstance(v, dict):
        v = v.get("raw")
    if isinstance(v, (int, float)):
        return float(v)
    return None


async def _fetch_one(symbol: str) -> Optional[dict]:
    # Cache hit (positive or negative)
    async with _cache_lock:
        cached = _cache.get(symbol)
        if cached:
            ts, val = cached
            age = time.time() - ts
            if val is not None and age < CACHE_TTL_S:
                return val
            if val is None and age < NEG_CACHE_TTL_S:
                return None

    assert _client is not None and _sem is not None
    row: Optional[dict] = None

    async with _sem:
        # Two-shot strategy: try with current crumb. If we get 401/429,
        # invalidate the crumb, get a new one, and retry once.
        for attempt in range(2):
            crumb = await _ensure_crumb()
            if crumb is None:
                log.warning("no crumb available; cannot fetch %s", symbol)
                break

            url = f"{YAHOO_BASE}/{symbol}?modules={MODULES}&crumb={crumb}"
            try:
                res = await _client.get(url)
            except (httpx.TimeoutException, httpx.RequestError) as e:
                log.warning("fetch %s transport error: %s", symbol, type(e).__name__)
                break

            if res.status_code == 200:
                try:
                    doc = res.json()
                    qs = doc.get("quoteSummary", {})
                    results = qs.get("result")
                    if results:
                        modules = results[0] or {}
                        fd = modules.get("financialData") or {}
                        dks = modules.get("defaultKeyStatistics") or {}
                        sd = modules.get("summaryDetail") or {}

                        row = {
                            "revenue_growth":  _g(fd, "revenueGrowth"),
                            "earnings_growth": _g(fd, "earningsGrowth"),
                            "profit_margin":   _g(fd, "profitMargins"),
                            "roe":             _g(fd, "returnOnEquity"),
                            "debt_to_equity":  _g(fd, "debtToEquity"),
                            "forward_pe":      _g(sd, "forwardPE") or _g(dks, "forwardPE"),
                        }
                        de = row["debt_to_equity"]
                        if de is not None and de > 5:
                            row["debt_to_equity"] = de / 100.0
                    break
                except Exception as e:  # noqa: BLE001
                    log.warning("fetch %s parse error: %s", symbol, e)
                    break
            elif res.status_code in (401, 429):
                # Crumb may have expired or been revoked. Refresh and retry once.
                log.warning("yahoo %s returned %d (attempt %d) — refreshing crumb",
                            symbol, res.status_code, attempt + 1)
                await _invalidate_crumb()
                continue
            else:
                log.warning("yahoo %s returned %d", symbol, res.status_code)
                break

    async with _cache_lock:
        _cache[symbol] = (time.time(), row)
    return row


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "started_at": _started_at,
        "cache_size": len(_cache),
        "cache_success": sum(1 for _, v in _cache.values() if v is not None),
        "cache_ttl_s": CACHE_TTL_S,
        "neg_cache_ttl_s": NEG_CACHE_TTL_S,
        "max_concurrent": MAX_CONCURRENT,
        "has_crumb": _crumb is not None,
        "crumb_age_s": int(time.time() - _crumb_ts) if _crumb else None,
    }


@app.post("/fundamentals", response_model=FundamentalsResponse)
async def fundamentals(body: SymbolList) -> FundamentalsResponse:
    if not body.symbols:
        return FundamentalsResponse(rows=[], skipped=[])

    syms = [s.strip().upper() for s in body.symbols if s.strip()]
    if not syms:
        return FundamentalsResponse(rows=[], skipped=[])

    results = await asyncio.gather(*(_fetch_one(s) for s in syms))

    rows: list[FundamentalRow] = []
    skipped: list[str] = []
    for sym, data in zip(syms, results):
        if data is None:
            skipped.append(sym)
            continue
        rows.append(FundamentalRow(symbol=sym, **data))
    return FundamentalsResponse(rows=rows, skipped=skipped)
