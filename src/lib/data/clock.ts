// Alpaca market clock client.
// Docs: https://docs.alpaca.markets/reference/getclock
// NOTE: trading API base (api.alpaca.markets), NOT the data API.

const TRADING_BASE = "https://api.alpaca.markets";

export type MarketPhase = "regular" | "extended" | "closed";

export interface ClockState {
  isOpen: boolean;
  phase: MarketPhase;
  nextOpen: string;     // ISO
  nextClose: string;    // ISO
  timestamp: string;    // ISO server time
}

interface RawClock {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
}

export class AlpacaClockError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "AlpacaClockError";
  }
}

function authHeaders(): Record<string, string> {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;
  if (!key || !secret) {
    throw new AlpacaClockError("ALPACA_API_KEY / ALPACA_API_SECRET not set");
  }
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    Accept: "application/json",
  };
}

interface ClockCache {
  state: ClockState | null;
  ts: number;
}
const cache: ClockCache = { state: null, ts: 0 };
const CLOCK_TTL_MS = 60_000;

const EXTENDED_WINDOW_MS = 30 * 60 * 1000;

function closedDefault(): ClockState {
  const now = new Date().toISOString();
  return {
    isOpen: false,
    phase: "closed",
    nextOpen: now,
    nextClose: now,
    timestamp: now,
  };
}

function derivePhase(raw: RawClock): MarketPhase {
  if (raw.is_open) return "regular";
  const now = new Date(raw.timestamp).getTime();
  const nextOpen = new Date(raw.next_open).getTime();
  const nextClose = new Date(raw.next_close).getTime();

  // 30min before next open -> extended (pre-market).
  if (Number.isFinite(nextOpen) && nextOpen - now > 0 && nextOpen - now <= EXTENDED_WINDOW_MS) {
    return "extended";
  }
  // Within 30min AFTER the most-recent close. When the market is closed, Alpaca's
  // next_close sits in the future (the *next* session's close). The most recent
  // close is therefore nextClose - one trading day (~6.5h after nextOpen).
  // Approximation: if next_close > next_open, the last close occurred ~ nextClose
  // - 24h. We use the simpler heuristic: extended if now is within 30min of the
  // previous trading session boundary, inferred from the gap between next_open
  // and next_close.
  const sessionLenMs = nextClose - nextOpen;
  if (Number.isFinite(sessionLenMs) && sessionLenMs > 0) {
    const prevClose = nextOpen - (24 * 3600 * 1000 - sessionLenMs);
    if (now - prevClose >= 0 && now - prevClose <= EXTENDED_WINDOW_MS) {
      return "extended";
    }
  }
  return "closed";
}

export async function getClock(): Promise<ClockState> {
  if (cache.state && Date.now() - cache.ts < CLOCK_TTL_MS) {
    return cache.state;
  }
  try {
    const res = await fetch(`${TRADING_BASE}/v2/clock`, {
      headers: authHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new AlpacaClockError(
        `alpaca clock failed: ${res.status} ${res.statusText}`,
        res.status,
      );
    }
    const raw = (await res.json()) as RawClock;
    const state: ClockState = {
      isOpen: raw.is_open,
      phase: derivePhase(raw),
      nextOpen: raw.next_open,
      nextClose: raw.next_close,
      timestamp: raw.timestamp,
    };
    cache.state = state;
    cache.ts = Date.now();
    return state;
  } catch {
    // Fail-open: closed default.
    return closedDefault();
  }
}
