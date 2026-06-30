"""Fundamentals sidecar — direct Yahoo Finance quoteSummary client.

Bypasses yfinance entirely. yfinance 0.2.50's curl_cffi backend hangs
indefinitely on cold start in containerized environments, freezing every
single request to the sidecar.

Endpoint:
  GET https://query1.finance.yahoo.com/v10/finance/quoteSummary/<sym>
      ?modules=financialData,defaultKeyStatistics,summaryDetail

Yahoo returns:
  { quoteSummary: { result: [ { financialData: {...}, defaultKeyStatistics: {...},
                                summaryDetail: {...} } ], error: null } }

Numeric fields are wrapped as {raw: <number>, fmt: <str>}.
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
MODULES = "financialData,defaultKeyStatistics,summaryDetail"
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
HTTP_TIMEOUT_S = 8.0
CACHE_TTL_S = 24 * 3600       # 24 hours for successes
NEG_CACHE_TTL_S = 15 * 60     # 15 min for failures so we don't hammer Yahoo
MAX_CONCURRENT = 5

# symbol -> (cache_ts, row_dict_or_None)
_cache: dict[str, tuple[float, Optional[dict]]] = {}
_cache_lock = asyncio.Lock()
_sem: Optional[asyncio.Semaphore] = None
_client: Optional[httpx.AsyncClient] = None
_started_at: float = 0.0


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _sem, _client, _started_at
    _started_at = time.time()
    _sem = asyncio.Semaphore(MAX_CONCURRENT)
    _client = httpx.AsyncClient(
        timeout=httpx.Timeout(HTTP_TIMEOUT_S),
        headers={"User-Agent": UA, "Accept": "application/json"},
        follow_redirects=True,
    )
    log.info("fundamentals sidecar ready")
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
    """Extract a raw float from Yahoo's {raw: <num>, fmt: <str>, longFmt: <str>}
    wrapper shape. Returns None for missing or malformed values."""
    if not isinstance(d, dict):
        return None
    v = d.get(key)
    if isinstance(v, dict):
        v = v.get("raw")
    if isinstance(v, (int, float)):
        return float(v)
    return None


async def _fetch_one(symbol: str) -> Optional[dict]:
    """Fetch one symbol. Returns parsed row dict, or None if Yahoo gave us nothing
    usable. Result is cached with separate TTLs for success vs failure."""
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
    url = f"{YAHOO_BASE}/{symbol}?modules={MODULES}"

    row: Optional[dict] = None
    async with _sem:
        try:
            res = await _client.get(url)
            if res.status_code == 200:
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
                        # forward_pe shows up under summaryDetail OR defaultKeyStatistics
                        "forward_pe":      _g(sd, "forwardPE") or _g(dks, "forwardPE"),
                    }

                    # Yahoo historically flipped between decimal and percent for D/E.
                    # Modern responses tend to give percent (e.g. 200.4 = 200%). The
                    # engine ranker expects a smaller number (lower=better), so we
                    # divide by 100 when it's clearly a percent. Matches ml1/data.py.
                    de = row["debt_to_equity"]
                    if de is not None and de > 5:
                        row["debt_to_equity"] = de / 100.0
            elif res.status_code in (429, 401, 403):
                log.warning("yahoo %s returned %d", symbol, res.status_code)
        except (httpx.TimeoutException, httpx.RequestError) as e:
            log.warning("fetch %s transport error: %s", symbol, type(e).__name__)
        except Exception as e:  # noqa: BLE001
            log.warning("fetch %s parse error: %s", symbol, e)

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
