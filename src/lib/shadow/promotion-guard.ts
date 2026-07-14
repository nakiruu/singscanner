// Shadow monitor promotion guard.
//
// Wraps `computePosterior` with two hardenings against false-positive
// challenger promotions:
//
//   1. k-consecutive-cycles counter — continuous peeking at nominal 5%
//      significance inflates actual type-I to 20-40% (Johari, Koomen,
//      Pekelis & Walsh 2017, KDD). Requiring the posterior to clear its bar
//      in ≥ k consecutive checks with a minimum time spacing between checks
//      restores nominal significance under weak dependence.
//
//   2. DSR floor — the naive `SHADOW_MIN_POSTERIOR_DELTA_BPS=0` threshold
//      is a single-trial test. When the pipeline sweeps N candidate configs,
//      the Deflated Sharpe Ratio floor rejects apparent uplifts that would
//      not clear a search-corrected significance bar (Bailey/López de Prado
//      2014, JPM).
//
// In-memory counter — restart resets state. CH-backed persistence for
// restart survival is deferred to a follow-up.

import type { Posterior } from "./posterior";
import { deflatedSharpeRatio, dsrPromotionFloor } from "./dsr";

const K_CONSECUTIVE = Math.max(1, Number(process.env.SHADOW_PROMOTION_K ?? "2"));
const MIN_SPACING_MS = Math.max(0, Number(process.env.SHADOW_PROMOTION_MIN_SPACING_MS ?? "60000"));
const DSR_ENABLED = process.env.SHADOW_DSR_GATE === "1";
const DSR_ALPHA = Math.max(0.001, Math.min(0.5, Number(process.env.SHADOW_DSR_ALPHA ?? "0.05")));
const DSR_N_TRIALS = Math.max(1, Number(process.env.SHADOW_DSR_N_TRIALS ?? "10"));

export interface PromotionDecision {
  canPromote: boolean;
  reason: string;
  // Diagnostics — safe to surface in the admin dashboard.
  consecutiveOK: number;
  dsr: number;              // NaN if not evaluated
  requiredDeltaBps: number; // DSR-adjusted floor (>= 0)
  lastCheckMs: number;
}

interface GuardState {
  consecutiveOK: number;
  lastCheckMs: number;
}

export class PromotionGuard {
  private readonly byHorizon = new Map<string, GuardState>();

  // Evaluate a fresh posterior against the peeking + DSR criteria.
  // Idempotent per (horizon, time) — safe to call multiple times per cycle.
  check(horizon: string, posterior: Posterior, nowMs: number = Date.now()): PromotionDecision {
    const s = this.byHorizon.get(horizon) ?? { consecutiveOK: 0, lastCheckMs: 0 };

    // DSR component. When posterior SE is unavailable (n < 2 or degenerate),
    // fall back to the raw posterior mean test.
    let dsr = Number.NaN;
    let requiredDeltaBps = 0;
    let dsrOK = true;
    if (DSR_ENABLED && posterior.delta_post_se_bps > 0) {
      const observedSharpe = posterior.delta_post_bps / posterior.delta_post_se_bps;
      dsr = deflatedSharpeRatio(observedSharpe, DSR_N_TRIALS);
      requiredDeltaBps = dsrPromotionFloor(
        posterior.delta_post_se_bps,
        DSR_N_TRIALS,
        DSR_ALPHA,
      );
      dsrOK = posterior.delta_post_bps >= requiredDeltaBps;
    }

    const baseOK = posterior.promotable;
    const passesThisCheck = baseOK && dsrOK;

    // Time-spacing enforcement — bump the consecutive counter only when the
    // caller respects the minimum spacing. Reset on any failing check.
    let consecutiveOK = s.consecutiveOK;
    if (passesThisCheck) {
      if (s.lastCheckMs === 0 || (nowMs - s.lastCheckMs) >= MIN_SPACING_MS) {
        consecutiveOK = s.consecutiveOK + 1;
      }
    } else {
      consecutiveOK = 0;
    }

    const next: GuardState = { consecutiveOK, lastCheckMs: nowMs };
    this.byHorizon.set(horizon, next);

    const canPromote = passesThisCheck && consecutiveOK >= K_CONSECUTIVE;
    const reason = canPromote
      ? `promotion-ready (k=${consecutiveOK}/${K_CONSECUTIVE}, DSR=${dsrLabel(dsr)})`
      : buildFailReason({
          baseOK,
          dsrEnabled: DSR_ENABLED,
          dsrOK,
          consecutiveOK,
          k: K_CONSECUTIVE,
          posterior,
          requiredDeltaBps,
          dsr,
        });

    return {
      canPromote,
      reason,
      consecutiveOK,
      dsr,
      requiredDeltaBps,
      lastCheckMs: nowMs,
    };
  }

  // Reset per-horizon state — useful for the operator "unstick" case where
  // the pipeline is confident a legitimate promotion is being blocked by a
  // stale counter.
  reset(horizon: string): void {
    this.byHorizon.delete(horizon);
  }

  // Inspection accessor for the admin dashboard.
  peek(horizon: string): PromotionDecision | null {
    const s = this.byHorizon.get(horizon);
    if (!s) return null;
    return {
      canPromote: false,
      reason: "peek",
      consecutiveOK: s.consecutiveOK,
      dsr: Number.NaN,
      requiredDeltaBps: 0,
      lastCheckMs: s.lastCheckMs,
    };
  }
}

// -- Helpers -----------------------------------------------------------------

function dsrLabel(dsr: number): string {
  return Number.isNaN(dsr) ? "n/a" : dsr.toFixed(2);
}

interface FailReasonInput {
  baseOK: boolean;
  dsrEnabled: boolean;
  dsrOK: boolean;
  consecutiveOK: number;
  k: number;
  posterior: Posterior;
  requiredDeltaBps: number;
  dsr: number;
}

function buildFailReason(x: FailReasonInput): string {
  const parts: string[] = [];
  if (!x.baseOK) parts.push(`posterior: ${x.posterior.reason}`);
  if (x.dsrEnabled && !x.dsrOK) {
    parts.push(
      `dsr-floor: δ_post=${x.posterior.delta_post_bps.toFixed(1)} < required=${x.requiredDeltaBps.toFixed(1)}bps (DSR=${dsrLabel(x.dsr)})`,
    );
  }
  if (x.consecutiveOK < x.k) parts.push(`peek-guard: k=${x.consecutiveOK}/${x.k}`);
  return parts.join(" | ") || "blocked";
}
