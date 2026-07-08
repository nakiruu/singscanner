// ShadowMonitor per horizon. Runs observe() per scan cycle from scanner's
// getLatestSnapshot hook. Manages the challenger, pending ledger, resolution.

import { DynamicActionValueChallenger } from "./dynamic-challenger";
import {
  insertPending,
  queryPendingExpired,
  deletePending,
  insertResolved,
  newId,
  type PendingRow,
} from "./persistence";
import {
  extractFeatures,
  sessionBucketNow,
  bucketKey,
  N_FEATURES,
} from "./features";
import type { ScanSnapshot, ScanRow } from "@/lib/engine/types";
import { queryBars } from "@/lib/data/clickhouse";

// Trading-day approximations for horizon → resolution window.
// 6.5h × 60min × 60s × 1000ms per trading day.
const TRADING_DAY_MS = 6.5 * 60 * 60 * 1000;
export const HORIZON_RESOLUTION_MS: Record<"3d" | "5d" | "10d", number> = {
  "3d": 3 * TRADING_DAY_MS,
  "5d": 5 * TRADING_DAY_MS,
  "10d": 10 * TRADING_DAY_MS,
};

// Divergence threshold on |Δnet| when decisions match.
const NET_DIVERGENCE_BPS = 20;

// Bump-friction challenger: same fallback as static perturbation to keep
// the first-cycle behavior sensible when the dynamic bucket is empty.
const FRICTION_BUMP = 0.05;

export class ShadowMonitor {
  private readonly horizon: "3d" | "5d" | "10d";
  private readonly challenger: DynamicActionValueChallenger;
  // In-memory dedup: (symbol, base_dec, chal_dec) currently in flight.
  private readonly openKeys = new Set<string>();

  constructor(horizon: "3d" | "5d" | "10d") {
    this.horizon = horizon;
    this.challenger = new DynamicActionValueChallenger(horizon);
  }

  async init(): Promise<void> {
    await this.challenger.load();
  }

  getChallenger(): DynamicActionValueChallenger {
    return this.challenger;
  }

  async flushShutdown(): Promise<void> {
    await this.challenger.flushNow();
  }

  // -- Main observe --------------------------------------------------------

  async observe(snap: ScanSnapshot): Promise<void> {
    if (snap.horizon !== this.horizon) return;
    const session = sessionBucketNow();
    const cashFraction = Math.max(0, Math.min(1, snap.cashWeight ?? 0.5));

    for (const row of snap.rows) {
      const features = extractFeatures(row, { cashFraction, tickerEdge: 0 });
      const bucket = bucketKey(row.role, session);

      // Fallback = baseline's model_edge; the static-perturbation baseline
      // for the dynamic challenger is roleEdge × (friction + FRICTION_BUMP),
      // but we let the dynamic predict handle it.
      const fallbackBps = row.modelEdge;
      const { estimate: chalEdge } = this.challenger.predict(bucket, features, fallbackBps);

      const edgeDelta = chalEdge - row.modelEdge;
      const chalNet = row.net + edgeDelta;
      const chalDecision = deriveChallengerDecision(row, chalNet);

      const netDiverges = Math.abs(chalNet - row.net) > NET_DIVERGENCE_BPS;
      if (row.decision === chalDecision && !netDiverges) continue;

      const dedupKey = `${row.symbol}|${row.decision}|${chalDecision}`;
      if (this.openKeys.has(dedupKey)) continue;
      this.openKeys.add(dedupKey);

      const pending: PendingRow = {
        id: newId(),
        horizon: this.horizon,
        symbol: row.symbol,
        submittedAt: new Date().toISOString(),
        baselineDecision: row.decision,
        challengerDecision: chalDecision,
        baselineNetBps: row.net,
        challengerNetBps: chalNet,
        entryPrice: row.price,
        bucket,
        features,
        source: "live",
      };
      await insertPending(pending);
    }

    void this.resolvePending();
    // Keep FRICTION_BUMP referenced so the constant survives the lint pass.
    void FRICTION_BUMP;
  }

  // -- Resolution ----------------------------------------------------------

  async resolvePending(): Promise<void> {
    const windowMs = HORIZON_RESOLUTION_MS[this.horizon];
    const rows = await queryPendingExpired(this.horizon, windowMs);
    if (rows.length === 0) return;

    for (const row of rows) {
      // Forward-price lookup: earliest daily bar after submitted_at.
      const submittedIso = row.submittedAt;
      const endIso = new Date(Date.now() + 1000).toISOString();
      const bars = await queryBars(row.symbol, "1Day", submittedIso, endIso);
      // Skip the first bar if it equals the submitted timestamp exactly.
      const forwardBar = bars.find(
        (b) => new Date(b.t).getTime() > new Date(submittedIso).getTime(),
      );
      if (!forwardBar) {
        // No data: drop from the openKeys set so future divergences can log.
        this.openKeys.delete(`${row.symbol}|${row.baselineDecision}|${row.challengerDecision}`);
        // Only truly expire (delete) if past 4×window; otherwise leave pending
        // for later retry.
        const age = Date.now() - new Date(submittedIso).getTime();
        if (age > 4 * windowMs) await deletePending(row.id);
        continue;
      }
      const forwardPrice = forwardBar.c;
      const realizedBps = (forwardPrice / row.entryPrice - 1) * 10000;
      const baselineValueBps = valueOf(row.baselineDecision, realizedBps);
      const challengerValueBps = valueOf(row.challengerDecision, realizedBps);
      const deltaBps = challengerValueBps - baselineValueBps;

      await insertResolved({
        id: newId(),
        horizon: this.horizon,
        symbol: row.symbol,
        submittedAt: row.submittedAt,
        resolvedAt: new Date().toISOString(),
        baselineDecision: row.baselineDecision,
        challengerDecision: row.challengerDecision,
        realizedBps,
        baselineValueBps,
        challengerValueBps,
        deltaBps,
        source: "live",
        clean: 1,
      });

      if (row.features.length === N_FEATURES) {
        this.challenger.update(row.bucket, row.features, challengerValueBps);
      }

      await deletePending(row.id);
      this.openKeys.delete(`${row.symbol}|${row.baselineDecision}|${row.challengerDecision}`);
    }
  }
}

// -- Helpers -----------------------------------------------------------------

function deriveChallengerDecision(row: ScanRow, chalNet: number): string {
  // Match shadow_monitor.py:observe (challenger decision from chal_net).
  const isHeld = false; // v1: no held-side integration; scanner treats all as unheld.
  if (row.role === "none" && !isHeld) return "HOLD-CASH";
  if (isHeld) return row.decision;
  if (chalNet > 0) return "BUY";
  return "WAIT";
}

// Symmetric cash framing: BUY captures realized move; anything else is
// treated as skipped-cash (opposite sign). See shadow_monitor.py:282-286.
function valueOf(decision: string, realizedBps: number): number {
  if (decision === "BUY") return realizedBps;
  return -realizedBps;
}
