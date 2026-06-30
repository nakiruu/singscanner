"""Fundamentals sidecar — seeded cache + throttled background refresh.

Architecture (matches docs/DATA_ARCHITECTURE.md):

  1. **Seed file** — at startup, load a JSON of pre-fetched fundamentals if
     present at $FUNDAMENTALS_SEED_PATH (default /seed/fundamentals_seed.json).
     This is the user's existing local cache from the Python project. The
     /fundamentals endpoint returns these immediately, no Yahoo calls.

  2. **Persistent cache** — write the in-memory cache to disk every time it
     grows, at $FUNDAMENTALS_CACHE_PATH (default /cache/fundamentals.json).
     Mounted as a docker volume so it survives `docker compose up -d --build`.

  3. **Background refresh** — a single worker thread pulls symbols off a
     queue and calls yfinance with a 100ms throttle between calls. On 429
     it backs off exponentially (max 5 min). When Yahoo's mood improves,
     it picks back up.

  4. **Fail-open** — the /fundamentals endpoint never blocks on Yahoo. Any
     uncached or stale symbol is enqueued and returned in `skipped`. The
     scanner falls back to neutral Quality=50 for those symbols.

The Python reference (singscannerml2/data.py:704) uses the same pattern:
sequential, 50ms throttle, disk-cached, ~6h refresh interval.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from pydantic import BaseModel

try:
    import yfinance as yf  # type: ignore[import-untyped]
except Exception:
    yf = None  # type: ignore[assignment]

log = logging.getLogger("fund")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# ---------------------------------------------------------------------------
# Tunables (env-overridable)
# ---------------------------------------------------------------------------

SEED_PATH = Path(os.environ.get("FUNDAMENTALS_SEED_PATH", "/seed/fundamentals_seed.json"))
CACHE_PATH = Path(os.environ.get("FUNDAMENTALS_CACHE_PATH", "/cache/fundamentals.json"))

# DATA_ARCHITECTURE.md: fundamentals refresh every 6h. Within that window we
# never re-fetch a successful symbol.
CACHE_TTL_S = int(os.environ.get("FUNDAMENTALS_TTL_S", str(6 * 3600)))
NEG_CACHE_TTL_S = int(os.environ.get("FUNDAMENTALS_NEG_TTL_S", str(15 * 60)))
THROTTLE_S = float(os.environ.get("FUNDAMENTALS_THROTTLE_S", "0.10"))
PER_CALL_TIMEOUT_S = float(os.environ.get("FUNDAMENTALS_TIMEOUT_S", "12.0"))
BACKOFF_MAX_S = 300.0
QUEUE_MAX = 5000
CACHE_FLUSH_INTERVAL_S = 60  # flush to disk at most once per minute

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

# symbol -> (cache_ts, row_dict_or_None)
_cache: dict[str, tuple[float, Optional[dict]]] = {}
_cache_lock = asyncio.Lock()
_dirty = False
_last_flush = 0.0

_queue: asyncio.Queue[str] = asyncio.Queue()
_in_queue: set[str] = set()
_worker_task: Optional[asyncio.Task] = None
_started_at: float = 0.0

_consecutive_429s = 0
_backoff_until = 0.0
_fetches_ok = 0
_fetches_fail = 0
_fetches_429 = 0


# ---------------------------------------------------------------------------
# Seed + persistence
# ---------------------------------------------------------------------------

def _load_seed() -> int:
    """Load the seed file from the repo (read-only). Returns count loaded."""
    if not SEED_PATH.is_file():
        log.info("no seed file at %s", SEED_PATH)
        return 0
    try:
        raw = json.loads(SEED_PATH.read_text())
        # Python reference shape: {"ts": <epoch>, "data": {sym: {...}}}.
        data = raw.get("data", raw)
        seed_ts = float(raw.get("ts", time.time()))
        n = 0
        for sym, row in data.items():
            _cache[sym.upper()] = (seed_ts, row)
            n += 1
        log.info("seed loaded: %d symbols from %s (ts=%s)", n, SEED_PATH, int(seed_ts))
        return n
    except Exception as e:  # noqa: BLE001
        log.warning("seed load failed: %s", e)
        return 0


def _load_disk_cache() -> int:
    """Load the persistent cache (writable, ours). Wins over seed."""
    if not CACHE_PATH.is_file():
        return 0
    try:
        raw = json.loads(CACHE_PATH.read_text())
        data = raw.get("data", raw)
        n = 0
        for sym, entry in data.items():
            ts = float(entry["ts"])
            row = entry["row"]  # may be None for negative cache
            _cache[sym.upper()] = (ts, row)
            n += 1
        log.info("disk cache loaded: %d symbols from %s", n, CACHE_PATH)
        return n
    except Exception as e:  # noqa: BLE001
        log.warning("disk cache load failed: %s", e)
        return 0


async def _flush_to_disk_locked() -> None:
    """Write the cache to disk. Caller must hold _cache_lock."""
    global _dirty, _last_flush
    if not _dirty:
        return
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "ts": time.time(),
            "data": {sym: {"ts": ts, "row": row} for sym, (ts, row) in _cache.items()},
        }
        tmp = CACHE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload))
        tmp.replace(CACHE_PATH)
        _dirty = False
        _last_flush = time.time()
    except Exception as e:  # noqa: BLE001
        log.warning("cache flush failed: %s", e)


# ---------------------------------------------------------------------------
# yfinance fetch (sync, runs in executor)
# ---------------------------------------------------------------------------

def _safe_float(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:
        return None
    return f


class RateLimited(Exception):
    pass


def _fetch_sync(symbol: str) -> Optional[dict]:
    """Blocking yfinance call. Raises RateLimited on 429, returns dict on
    success, returns None for any other failure."""
    if yf is None:
        return None
    try:
        t = yf.Ticker(symbol)
        info = t.get_info() or {}
    except Exception as e:
        # yfinance signals 429 by leaving info empty AND emitting a 429 log
        # earlier. We treat a totally empty info as a probable rate-limit when
        # we're seeing a streak. Caller does the streak detection.
        msg = str(e)
        if "429" in msg or "Too Many Requests" in msg:
            raise RateLimited(msg) from e
        return None

    if not info:
        return None

    g = info.get
    de = _safe_float(g("debtToEquity"))
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


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

async def _worker_loop() -> None:
    """Drain the queue, fetch with timeout + throttle + exponential backoff."""
    global _fetches_ok, _fetches_fail, _fetches_429, _consecutive_429s, _backoff_until, _dirty
    log.info("background fetch worker started (yf=%s)", "ok" if yf else "MISSING")
    loop = asyncio.get_running_loop()

    while True:
        symbol = await _queue.get()
        try:
            # If we're in a backoff period, sleep till it clears.
            now = time.time()
            if _backoff_until > now:
                wait = _backoff_until - now
                log.info("backoff: sleeping %.1fs before %s", wait, symbol)
                await asyncio.sleep(wait)

            try:
                row = await asyncio.wait_for(
                    loop.run_in_executor(None, _fetch_sync, symbol),
                    timeout=PER_CALL_TIMEOUT_S,
                )
                async with _cache_lock:
                    _cache[symbol] = (time.time(), row)
                    _dirty = True
                if row is not None:
                    _fetches_ok += 1
                    _consecutive_429s = 0  # success resets backoff
                else:
                    _fetches_fail += 1
            except RateLimited:
                _fetches_429 += 1
                _consecutive_429s += 1
                # Exponential backoff: 30s, 60s, 2min, 5min, 5min...
                wait = min(BACKOFF_MAX_S, 30.0 * (2 ** (_consecutive_429s - 1)))
                _backoff_until = time.time() + wait
                log.warning("rate-limited (%d streak), backing off %.0fs",
                            _consecutive_429s, wait)
                # put symbol back so we retry it after backoff
                _in_queue.discard(symbol)
                await _enqueue(symbol)
            except asyncio.TimeoutError:
                _fetches_fail += 1
                async with _cache_lock:
                    _cache[symbol] = (time.time(), None)
                    _dirty = True
                log.warning("yfinance %s timed out", symbol)

            # opportunistic disk flush
            if time.time() - _last_flush > CACHE_FLUSH_INTERVAL_S:
                async with _cache_lock:
                    await _flush_to_disk_locked()
        finally:
            _in_queue.discard(symbol)
            _queue.task_done()
            await asyncio.sleep(THROTTLE_S)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _worker_task, _started_at
    _started_at = time.time()
    _load_seed()
    _load_disk_cache()
    _worker_task = asyncio.create_task(_worker_loop())
    log.info("fundamentals sidecar ready (cache_size=%d)", len(_cache))
    try:
        yield
    finally:
        async with _cache_lock:
            await _flush_to_disk_locked()
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
        "fetches_429": _fetches_429,
        "consecutive_429s": _consecutive_429s,
        "backoff_remaining_s": max(0, int(_backoff_until - time.time())),
        "queue_depth": _queue.qsize(),
        "seed_loaded": SEED_PATH.is_file(),
        "cache_loaded": CACHE_PATH.is_file(),
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
        if entry is not None and entry[1] is not None and _is_fresh(entry[0], entry[1]):
            rows.append(FundamentalRow(symbol=sym, **entry[1]))
            continue
        # Not cached, cached failure (older than NEG_TTL), or stale success
        # -> enqueue for refresh and skip this round.
        await _enqueue(sym)
        skipped.append(sym)

    return FundamentalsResponse(rows=rows, skipped=skipped)
