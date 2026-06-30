// Alpaca Market Data v2 snapshot client.
// Docs: https://docs.alpaca.markets/reference/stocksnapshots-1
//
// Returns per-symbol snapshot suitable for feeding the engine's cost gate.
// Does NOT fetch historical bars yet — those are required for the real signal
// families (ret_21d, realized vol, beta) and will come in a follow-up.

const BASE = "https://data.alpaca.markets/v2";

export interface AlpacaSnapshot {
  symbol: string;
  price: number;          // latestTrade.p
  bid: number;
  ask: number;
  spreadBps: number;      // (ask-bid)/mid * 10_000
  relVol: number;         // dailyBar.v / prevDailyBar.v
  gapDays: number;        // trading days since prevDailyBar
  quoteAgeSec: number;
  prevClose: number;
  dailyVolume: number;
  source: "alpaca";
}

interface RawSnapshot {
  symbol?: string;
  latestTrade?: { p: number; t: string };
  latestQuote?: { bp: number; ap: number; t: string };
  dailyBar?: { v: number; c: number; t: string };
  prevDailyBar?: { v: number; c: number; t: string };
}

export class AlpacaError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "AlpacaError";
  }
}

function headers() {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;
  if (!key || !secret) throw new AlpacaError("ALPACA_API_KEY / ALPACA_API_SECRET not set");
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    Accept: "application/json",
  };
}

export async function fetchSnapshots(symbols: string[]): Promise<AlpacaSnapshot[]> {
  if (symbols.length === 0) return [];
  const feed = process.env.ALPACA_FEED ?? "iex";
  const url = `${BASE}/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(","))}&feed=${feed}`;

  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    throw new AlpacaError(`alpaca snapshots failed: ${res.status} ${res.statusText}`, res.status);
  }

  // Response shape: { "AAPL": { latestTrade, latestQuote, dailyBar, prevDailyBar, minuteBar }, ... }
  const data = (await res.json()) as Record<string, RawSnapshot>;
  const now = Date.now();
  const out: AlpacaSnapshot[] = [];

  for (const symbol of symbols) {
    const r = data[symbol];
    if (!r?.latestTrade || !r.latestQuote || !r.dailyBar) continue;

    const price = r.latestTrade.p;
    const bid = r.latestQuote.bp;
    const ask = r.latestQuote.ap;
    const mid = (bid + ask) / 2 || price;
    const spreadBps = mid > 0 ? Math.max(0, ((ask - bid) / mid) * 10_000) : 0;
    const prevVol = r.prevDailyBar?.v ?? r.dailyBar.v;
    const relVol = prevVol > 0 ? r.dailyBar.v / prevVol : 1;
    const quoteAgeSec = Math.max(0, (now - new Date(r.latestQuote.t).getTime()) / 1000);
    const prevClose = r.prevDailyBar?.c ?? r.dailyBar.c;

    // Gap: trading days between prevDailyBar.t and dailyBar.t. Cheap calendar approx
    // (we don't have a trading calendar here) — close enough for the gate's clamp.
    const gapDays =
      r.prevDailyBar
        ? Math.max(
            1,
            Math.round(
              (new Date(r.dailyBar.t).getTime() - new Date(r.prevDailyBar.t).getTime()) /
                (24 * 3600 * 1000),
            ),
          )
        : 1;

    out.push({
      symbol,
      price,
      bid,
      ask,
      spreadBps: Number(spreadBps.toFixed(2)),
      relVol: Number(relVol.toFixed(3)),
      gapDays,
      quoteAgeSec: Number(quoteAgeSec.toFixed(1)),
      prevClose,
      dailyVolume: r.dailyBar.v,
      source: "alpaca",
    });
  }

  return out;
}
