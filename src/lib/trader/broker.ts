// Thin typed wrapper over the Alpaca Trading REST API (paper only).
// Safety: constructor refuses any base URL that doesn't contain "paper".
// All operations throw BrokerError on failure; 429s get exponential backoff
// (250ms, 1s, 3s) then throw.

export class BrokerError extends Error {
  constructor(message: string, public status?: number, public alpacaCode?: string) {
    super(message);
    this.name = "BrokerError";
  }
}

export interface BrokerConfig {
  keyId: string;
  secret: string;
  baseUrl: string;   // must contain "paper"
}

export interface AccountSnapshot {
  equity: number;
  buyingPower: number;
  cash: number;
}

export interface PositionState {
  symbol: string;
  qty: number;
  avgPrice: number;
  marketValue: number;
  currentPrice: number;
  unrealizedPl: number;
  unrealizedPlPct: number;   // fraction, e.g. 0.023
}

export interface OpenOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: string;
  qty: number;
  limitPrice: number | null;
  stopPrice: number | null;
  submittedAt: string;
}

export interface BracketArgs {
  symbol: string;
  qty: number;
  entryLimit?: number;        // omit for market entry
  stopPrice: number;
  stopLimitPrice: number;
  takeProfitLimit: number;
}

export interface OcoArgs {
  symbol: string;
  qty: number;
  stopPrice: number;
  stopLimitPrice: number;
  takeProfitLimit: number;
}

export interface LimitArgs {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  limitPrice: number;
  extended?: boolean;
}

// Alpaca sub-penny rules: $0.01 tick at >= $1, $0.0001 below.
export function roundPrice(px: number): number {
  return px >= 1 ? Math.round(px * 100) / 100 : Math.round(px * 10000) / 10000;
}

// Validate/round a bracket's stop/target vs current price. Alpaca requires
// stop < price < target with >= 1 tick separation. Null when unfixable.
export function sanitizeBracket(
  price: number,
  stop: number,
  target: number,
): { stop: number; target: number } | null {
  if (!price || price <= 0) return null;
  const tick = price >= 1 ? 0.01 : 0.0001;
  const s = roundPrice(Math.min(stop, price - tick));
  const t = roundPrice(Math.max(target, price + tick));
  if (s <= 0 || s >= price || t <= price) return null;
  return { stop: s, target: t };
}

function px(v: number): string {
  return v >= 1 ? v.toFixed(2) : v.toFixed(4);
}

const BACKOFF_MS = [250, 1000, 3000];

interface RawOrder {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: string | null;
  limit_price: string | null;
  stop_price: string | null;
  submitted_at: string;
}

export class Broker {
  private headers: Record<string, string>;
  private base: string;

  constructor(cfg: BrokerConfig) {
    const base = cfg.baseUrl.replace(/\/+$/, "");
    if (!base.includes("paper")) {
      throw new BrokerError(
        `TRADER SAFETY: base URL ${base} is not a paper endpoint — refusing to start`,
      );
    }
    if (!cfg.keyId || !cfg.secret) {
      throw new BrokerError("TRADER SAFETY: missing key/secret");
    }
    this.base = base;
    this.headers = {
      "APCA-API-KEY-ID": cfg.keyId,
      "APCA-API-SECRET-KEY": cfg.secret,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers: this.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
      if (res.status === 429 && attempt < BACKOFF_MS.length) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        continue;
      }
      // DELETE endpoints return 204/207 with empty or multi-status bodies.
      if (res.ok || (method === "DELETE" && (res.status === 204 || res.status === 207 || res.status === 404))) {
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      }
      let code: string | undefined;
      let message = `${res.status} ${res.statusText}`;
      try {
        const err = (await res.json()) as { code?: number | string; message?: string };
        if (err.message) message = `${message}: ${err.message}`;
        code = err.code != null ? String(err.code) : undefined;
      } catch { /* non-JSON error body */ }
      throw new BrokerError(`alpaca ${method} ${path} failed: ${message}`, res.status, code);
    }
  }

  async getAccount(): Promise<AccountSnapshot> {
    const a = await this.request<{ equity: string; buying_power: string; cash: string }>(
      "GET", "/v2/account",
    );
    return {
      equity: Number(a.equity) || 0,
      buyingPower: Number(a.buying_power) || 0,
      cash: Number(a.cash) || 0,
    };
  }

  async getPositions(): Promise<Map<string, PositionState>> {
    const raw = await this.request<Array<Record<string, string>>>("GET", "/v2/positions");
    const out = new Map<string, PositionState>();
    for (const p of raw) {
      const qty = Number(p.qty) || 0;
      if (qty <= 0) continue;
      out.set(p.symbol, {
        symbol: p.symbol,
        qty,
        avgPrice: Number(p.avg_entry_price) || 0,
        marketValue: Number(p.market_value) || 0,
        currentPrice: Number(p.current_price) || 0,
        unrealizedPl: Number(p.unrealized_pl) || 0,
        unrealizedPlPct: Number(p.unrealized_plpc) || 0,
      });
    }
    return out;
  }

  async getOpenOrders(): Promise<OpenOrder[]> {
    const raw = await this.request<RawOrder[]>("GET", "/v2/orders?status=open&limit=500");
    return raw.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side === "sell" ? "sell" : "buy",
      orderType: o.type,
      qty: Number(o.qty) || 0,
      limitPrice: o.limit_price != null ? Number(o.limit_price) : null,
      stopPrice: o.stop_price != null ? Number(o.stop_price) : null,
      submittedAt: o.submitted_at,
    }));
  }

  async submitBracket(args: BracketArgs): Promise<{ orderId: string }> {
    const body: Record<string, unknown> = {
      symbol: args.symbol,
      qty: String(Math.floor(args.qty)),
      side: "buy",
      type: args.entryLimit != null ? "limit" : "market",
      time_in_force: "gtc",
      order_class: "bracket",
      take_profit: { limit_price: px(args.takeProfitLimit) },
      stop_loss: { stop_price: px(args.stopPrice), limit_price: px(args.stopLimitPrice) },
    };
    if (args.entryLimit != null) body.limit_price = px(args.entryLimit);
    const o = await this.request<{ id: string }>("POST", "/v2/orders", body);
    return { orderId: o.id };
  }

  async submitOco(args: OcoArgs): Promise<{ orderId: string }> {
    const o = await this.request<{ id: string }>("POST", "/v2/orders", {
      symbol: args.symbol,
      qty: String(Math.floor(args.qty)),
      side: "sell",
      type: "limit",
      time_in_force: "gtc",
      order_class: "oco",
      take_profit: { limit_price: px(args.takeProfitLimit) },
      stop_loss: { stop_price: px(args.stopPrice), limit_price: px(args.stopLimitPrice) },
    });
    return { orderId: o.id };
  }

  async submitLimit(args: LimitArgs): Promise<{ orderId: string }> {
    const o = await this.request<{ id: string }>("POST", "/v2/orders", {
      symbol: args.symbol,
      qty: String(Math.floor(args.qty)),
      side: args.side,
      type: "limit",
      limit_price: px(args.limitPrice),
      time_in_force: "day",
      extended_hours: !!args.extended,
    });
    return { orderId: o.id };
  }

  async cancelOrdersFor(symbol: string): Promise<void> {
    const open = await this.getOpenOrders();
    for (const o of open) {
      if (o.symbol !== symbol) continue;
      await this.request<unknown>("DELETE", `/v2/orders/${o.id}`);
    }
  }

  // Cancel the symbol's open orders (bracket legs), then liquidate.
  // Returns null when the liquidation itself fails (caller logs it).
  async closePosition(symbol: string): Promise<{ orderId: string } | null> {
    await this.cancelOrdersFor(symbol);
    await new Promise((r) => setTimeout(r, 250)); // let cancels settle
    try {
      const o = await this.request<{ id?: string }>("DELETE", `/v2/positions/${symbol}`);
      return o.id ? { orderId: o.id } : { orderId: "" };
    } catch {
      return null;
    }
  }
}
