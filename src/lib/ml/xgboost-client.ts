// Thin client for the XGBoost inference sidecar.
// Fails open: any network/transport error returns an empty result so the
// scanner pipeline can keep running with mlScore=null.

const FEATURE_COLS = [
  "ret_21d", "ret_63d", "ret_126d", "ret_prev_21d", "accel",
  "trend_slope", "dist_sma50", "dist_sma200", "breakout",
  "realized_vol_ann", "beta", "max_drawdown_60d",
  "rel_volume", "spread_bps",
  "revenue_growth", "earnings_growth", "profit_margin", "roe",
  "debt_to_equity", "forward_pe",
] as const;

export type XgbFeatureName = (typeof FEATURE_COLS)[number];
export type XgbFeatures = Partial<Record<XgbFeatureName, number | null>>;

export interface XgbInput {
  symbol: string;
  features: XgbFeatures;
}

export interface XgbResult {
  symbol: string;
  p_up: number;     // 0..1
  ml_score: number; // 0..100
}

export interface XgbResponse {
  loaded: boolean;
  rows: XgbResult[];
  skipped: string[];
}

const BASE = process.env.XGB_SIDECAR_URL ?? "http://xgboost:8000";
const TIMEOUT_MS = Number(process.env.XGB_TIMEOUT_MS ?? "2500");

let lastHealth: { ok: boolean; ts: number } = { ok: false, ts: 0 };
const HEALTH_TTL_MS = 30_000;

async function pingHealth(): Promise<boolean> {
  // Cache health checks so a dead sidecar doesn't add latency to every scan.
  if (Date.now() - lastHealth.ts < HEALTH_TTL_MS) return lastHealth.ok;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1000);
    const res = await fetch(`${BASE}/health`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    lastHealth = { ok: res.ok, ts: Date.now() };
    return res.ok;
  } catch {
    lastHealth = { ok: false, ts: Date.now() };
    return false;
  }
}

export async function predictXgb(rows: XgbInput[]): Promise<XgbResponse> {
  if (rows.length === 0) return { loaded: false, rows: [], skipped: [] };
  if (!(await pingHealth())) {
    return { loaded: false, rows: [], skipped: rows.map((r) => r.symbol) };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/predict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) {
      console.warn("[xgb] predict failed:", res.status, res.statusText);
      return { loaded: false, rows: [], skipped: rows.map((r) => r.symbol) };
    }
    return (await res.json()) as XgbResponse;
  } catch (err) {
    console.warn("[xgb] predict transport error:", err);
    return { loaded: false, rows: [], skipped: rows.map((r) => r.symbol) };
  }
}

export { FEATURE_COLS };
