"""Fundamentals sidecar for Singularity Scanner.

Single endpoint: POST /fundamentals — takes a batch of symbols, returns
per-symbol fundamentals pulled from yfinance.

yfinance is rate-limited and slow, so:
  - Results are cached in memory for 24h per symbol.
  - Concurrent fetches are bounded by a semaphore (max 5 concurrent).
  - Per-symbol errors are swallowed; the symbol goes into `skipped` and
    the batch continues. The caller already has a fail-open pipeline.

Field mapping (verified against the original Python reference
singscannerml1/data.py:482-489):
    revenueGrowth   -> revenue_growth
    earningsGrowth  -> earnings_growth
    profitMargins   -> profit_margin
    returnOnEquity  -> roe
    debtToEquity    -> debt_to_equity   (yfinance sometimes returns this
                                         as a percentage; divide by 100
                                         when the raw value > 5, matching
                                         the reference)
    forwardPE       -> forward_pe
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

import yfinance as yf
from fastapi import FastAPI
from pydantic import BaseModel, Field

log = logging.getLogger("fundamentals")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

CACHE_TTL_S = 24 * 60 * 60  # 24 hours
MAX_CONCURRENT = 5

_started_at: Optional[float] = None
_cache: dict[str, tuple[float, "FundamentalRow"]] = {}
_cache_lock = asyncio.Lock()
_semaphore: Optional[asyncio.Semaphore] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _started_at, _semaphore
    _started_at = time.time()
    _semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    yield


app = FastAPI(title="singscanner-fundamentals", lifespan=lifespan)


class FundamentalsRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list)


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
    skipped: list[str] = []


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    # yfinance sometimes returns NaN-as-float; reject non-finite values.
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return f


def _normalize_debt_to_equity(raw) -> Optional[float]:
    """yfinance switched representations across versions. When the raw value
    looks like a percentage (>5 — no real D/E ratio is that high), divide by
    100. Matches singscannerml1/data.py:486-488."""
    f = _safe_float(raw)
    if f is None:
        return None
    if f > 5:
        return f / 100.0
    return f


def _fetch_sync(symbol: str) -> FundamentalRow:
    """Blocking yfinance call. Run in a thread via asyncio.to_thread."""
    t = yf.Ticker(symbol)
    info = t.info or {}
    g = info.get
    return FundamentalRow(
        symbol=symbol,
        revenue_growth=_safe_float(g("revenueGrowth")),
        earnings_growth=(
            _safe_float(g("earningsGrowth"))
            or _safe_float(g("earningsQuarterlyGrowth"))
        ),
        profit_margin=_safe_float(g("profitMargins")),
        roe=_safe_float(g("returnOnEquity")),
        debt_to_equity=_normalize_debt_to_equity(g("debtToEquity")),
        forward_pe=_safe_float(g("forwardPE")),
    )


async def _fetch_one(symbol: str) -> tuple[str, Optional[FundamentalRow]]:
    """Returns (symbol, row) on success; (symbol, None) on failure."""
    sym = symbol.strip().upper()
    if not sym:
        return symbol, None

    # Cache lookup.
    async with _cache_lock:
        hit = _cache.get(sym)
    if hit is not None:
        ts, row = hit
        if time.time() - ts < CACHE_TTL_S:
            return sym, row

    assert _semaphore is not None  # set in lifespan
    async with _semaphore:
        try:
            row = await asyncio.to_thread(_fetch_sync, sym)
        except Exception as e:
            log.warning("fundamentals fetch failed for %s: %s", sym, e)
            return sym, None

    async with _cache_lock:
        _cache[sym] = (time.time(), row)
    return sym, row


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "started_at": _started_at,
        "cache_size": len(_cache),
        "cache_ttl_s": CACHE_TTL_S,
        "max_concurrent": MAX_CONCURRENT,
    }


@app.post("/fundamentals", response_model=FundamentalsResponse)
async def fundamentals(req: FundamentalsRequest) -> FundamentalsResponse:
    if not req.symbols:
        return FundamentalsResponse(rows=[], skipped=[])

    # De-dupe but preserve order of first occurrence.
    seen: set[str] = set()
    ordered: list[str] = []
    for s in req.symbols:
        u = s.strip().upper()
        if u and u not in seen:
            seen.add(u)
            ordered.append(u)

    results = await asyncio.gather(*(_fetch_one(s) for s in ordered))

    rows: list[FundamentalRow] = []
    skipped: list[str] = []
    for sym, row in results:
        if row is None:
            skipped.append(sym)
        else:
            rows.append(row)

    return FundamentalsResponse(rows=rows, skipped=skipped)
