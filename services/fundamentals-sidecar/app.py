"""Fundamentals sidecar — yfinance, throttled, background refresh.

The original Python project at singscannerml1/2 successfully uses yfinance
against the same Yahoo endpoint that 429s our direct httpx attempt. The
difference is:

  * Calls are SEQUENTIAL with ~50-100ms between them. Yahoo allows ~10 r/s/IP.
  * yfinance handles cookies / crumb / session reuse internally.
  * Calls run in a thread (loop.run_in_executor), so the async event loop
    doesn't hang on curl_cffi TLS.
  * The actual scan path serves from an in-memory cache; a background task
    keeps the cache fresh.

So this sidecar:
  - On POST /fundamentals, returns immediately with whatever's cached.
    Any uncached or stale symbol is appended to a refresh queue and skipped.
  - A background worker pulls from the queue, fetches sequentially with a
    100ms gap + 10s per-symbol timeout. It caches successes for 24h and
    failures for 15min.
  - First scan after boot: cache is empty -> everyone shows up in `skipped`,
    and `Quality` falls back to 50. After ~30-60s the cache populates and
    Quality starts to mean something.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI
from pydantic import BaseModel

try:
    import yfinance as yf  # type: ignore[import-untyped]
except Exception:
    yf = None  # type: ignore[assignment]

log = logging.getLogger("fund")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

CACHE_TTL_S = 24 * 3600        # 24h cache for successes
NEG_CACHE_TTL_S = 15 * 60      # 15min for failures
PER_CALL_TIMEOUT_S = 10.0      # one yfinance call shouldn't take longer
THROTTLE_S = 0.10              # ~10 req/s
QUEUE_MAX = 5000

# symbol -> (cache_ts, row_dict_or_None)
_cache: dict[str, tuple[float, Optional[dict]]] = {}
_cache_lock = asyncio.Lock()

_queue: asyncio.Queue[str] = asyncio.Queue()
_in_queue: set[str] = set()
_worker_task: Optional[asyncio.Task] = None
_started_at: float = 0.0
_fetches_ok = 0
_fetches_fail = 0


def _safe_float(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None
    return f


def _fetch_sync(symbol: str) -> Optional[dict]:
    """Blocking yfinance call. Runs in a worker thread via run_in_executor.
    Returns the same dict shape as the API response, or None on failure."""
    if yf is None:
        return None
    try:
        t = yf.Ticker(symbol)
        info = t.get_info() or {}
    except Exception as e:
        log.warning("yfinance %s threw: %s", symbol, e)
        return None

    g = info.get
    de_raw = g("debtToEquity")
    de: Optional[float] = _safe_float(de_raw)
    # Yahoo flips between decimal and percent; >5 means percent → divide.
    if isinstance(de, float) and de > 5:
        de = de / 100.0

    return {
        "revenue_growth":  _safe_float(g("revenueGrowth")),
        "earnings_growth": _safe_float(g("earningsGrowth"))
                           or _safe_float(g("earningsQuarterlyGrowth")),
        "profit_margin":   _safe_float(g("profitMargins")),
        "roe":             _safe_float(g("returnOnEquity")),
        "debt_to_equity":  de,
        "forward_pe":      _safe_float(g("forwardPE")),
    }


async def _worker_loop() -> None:
    """Pull symbols off the queue, fetch with timeout, cache, throttle."""
    global _fetches_ok, _fetches_fail
    log.info("background fetch worker started (yf=%s)", "ok" if yf else "MISSING")
    loop = asyncio.get_running_loop()

    while True:
        symbol = await _queue.get()
        try:
            try:
                row = await asyncio.wait_for(
                    loop.run_in_executor(None, _fetch_sync, symbol),
                    timeout=PER_CALL_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                row = None
                log.warning("yfinance %s timed out", symbol)

            async with _cache_lock:
                _cache[symbol] = (time.time(), row)
            if row is not None:
                _fetches_ok += 1
            else:
                _fetches_fail += 1
        finally:
            _in_queue.discard(symbol)
            _queue.task_done()
            await asyncio.sleep(THROTTLE_S)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _worker_task, _started_at
    _started_at = time.time()
    _worker_task = asyncio.create_task(_worker_loop())
    log.info("fundamentals sidecar ready")
    try:
        yield
    finally:
        if _worker_task is not None:
            _worker_task.cancel()


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


def _is_fresh(ts: float, val: Optional[dict]) -> bool:
    age = time.time() - ts
    if val is not None:
        return age < CACHE_TTL_S
    return age < NEG_CACHE_TTL_S


async def _enqueue(symbol: str) -> None:
    """Add to the refresh queue if not already there. Bounded."""
    if symbol in _in_queue or _queue.qsize() >= QUEUE_MAX:
        return
    _in_queue.add(symbol)
    try:
        _queue.put_nowait(symbol)
    except asyncio.QueueFull:
        _in_queue.discard(symbol)


@app.get("/health")
def health() -> dict:
    ok_count = sum(1 for _, v in _cache.values() if v is not None)
    return {
        "ok": True,
        "yfinance": yf is not None,
        "started_at": _started_at,
        "cache_size": len(_cache),
        "cache_success": ok_count,
        "cache_fail": len(_cache) - ok_count,
        "fetches_ok": _fetches_ok,
        "fetches_fail": _fetches_fail,
        "queue_depth": _queue.qsize(),
        "throttle_s": THROTTLE_S,
    }


@app.post("/fundamentals", response_model=FundamentalsResponse)
async def fundamentals(body: SymbolList) -> FundamentalsResponse:
    if not body.symbols:
        return FundamentalsResponse(rows=[], skipped=[])

    syms = [s.strip().upper() for s in body.symbols if s.strip()]
    if not syms:
        return FundamentalsResponse(rows=[], skipped=[])

    rows: list[FundamentalRow] = []
    skipped: list[str] = []

    async with _cache_lock:
        cache_snapshot = dict(_cache)

    for sym in syms:
        entry = cache_snapshot.get(sym)
        if entry is not None and _is_fresh(entry[0], entry[1]) and entry[1] is not None:
            rows.append(FundamentalRow(symbol=sym, **entry[1]))
            continue
        # not cached, or cached failure, or stale -> enqueue + skip for now
        await _enqueue(sym)
        skipped.append(sym)

    return FundamentalsResponse(rows=rows, skipped=skipped)
