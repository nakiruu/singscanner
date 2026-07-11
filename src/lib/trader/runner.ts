// Per-horizon trading loop. One runner per Alpaca paper account. Wakes on
// 5-minute ET bar boundaries and executes the spec §2 cycle in order:
// sync → reconcile fills → repair → sells → re-attach exits → buys → rotations.
//
// The scanner evaluates all rows with isHeld:false, so held-position decisions
// are computed HERE via sellDecision() with stop/target re-anchored to the
// actual avg fill price (row levels are 0 on non-BUY rows).

import {
  Broker, BrokerError, sanitizeBracket, roundPrice,
  type AccountSnapshot, type OpenOrder, type PositionState,
} from "./broker";
import { sizePosition, convictionForRank, type TraderSettings } from "./sizing";
import { etSession, nextBarBoundary, isStale, type TraderSession } from "./session";
import { insertTraderOrder, insertPositionEvent } from "./persistence";
import {
  recordTraderCycle, recordSlippage, recordExit, recordError,
} from "@/lib/data/metrics";
import { getLatestSnapshot } from "@/lib/engine/scanner";
import { sellDecision } from "@/lib/engine/sell";
import { computeStopTarget } from "@/lib/engine/levels";
import { calibrate, parseHorizon } from "@/lib/engine/horizon";
import { scoreRotations } from "@/lib/engine/rotation";
import type { ScanRow } from "@/lib/engine/types";
import type { Calibration } from "@/lib/engine/horizon";

export type TraderHorizon = "3d" | "5d" | "10d";

export interface ExtendedSessionSettings {
  stopWiden: number;    // TRADER_EXT_STOP_WIDEN
  targetWiden: number;  // TRADER_EXT_TARGET_WIDEN
  limitSlip: number;    // TRADER_EXT_LIMIT_SLIP
}

export interface SessionSettings {
  premarketMinHour: number;  // TRADER_PREMARKET_MIN_HOUR
}

export interface RunnerConfig {
  horizon: TraderHorizon;
  broker: Broker;
  settings: TraderSettings;
  extendedSettings: ExtendedSessionSettings;
  sessionSettings: SessionSettings;
}

export interface PositionEvent {
  horizon: TraderHorizon;
  ts: number;
  kind: "entry" | "exit" | "rotation";
  symbol: string;
  qty: number;
  fillPrice: number;
  reason: string;
  pnlBps: number | null;
  positionPct: number;
}

const CLOSING_TOMBSTONE_MS = 600_000;
const STALE_SCAN_MS = 300_000;

interface TrackedEntry {
  targetQty: number;
  expectedPrice: number;
  orderId: string;
  sessionPhase: "regular" | "extended";
  rotation: boolean;
}

export class TraderRunner {
  private cfg: RunnerConfig;
  private calib: Calibration;
  private horizonMin: number;

  private account: AccountSnapshot = { equity: 0, buyingPower: 0, cash: 0 };
  private positions = new Map<string, PositionState>();
  private prevPositions: Map<string, PositionState> | null = null; // null until first sync
  private openOrders: OpenOrder[] = [];
  private closing = new Map<string, number>();       // symbol → close-submitted ts
  private lastExit = new Map<string, number>();      // symbol → exit ts (cooldown)
  private entryTs = new Map<string, number>();       // symbol → entry-submitted ts
  private pendingEntries = new Map<string, TrackedEntry>();
  private listeners = new Set<(e: PositionEvent) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastCycleAt: number | null = null;
  private cycling = false;

  constructor(cfg: RunnerConfig) {
    this.cfg = cfg;
    this.horizonMin = parseHorizon(cfg.horizon);
    this.calib = calibrate(this.horizonMin);
  }

  start(): void {
    if (this.timer) return;
    this.scheduleNext();
    console.log(`[trader:${this.cfg.horizon}] runner started`);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getAccountSnapshot(): AccountSnapshot { return this.account; }
  getHoldings(): PositionState[] { return [...this.positions.values()]; }
  getOpenOrders(): OpenOrder[] { return [...this.openOrders]; }
  getLastCycleAt(): number | null { return this.lastCycleAt; }

  onEvent(listener: (e: PositionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scheduleNext(): void {
    const next = nextBarBoundary();
    this.timer = setTimeout(() => void this.cycle(), Math.max(1000, next - Date.now()));
  }

  private emit(e: PositionEvent): void {
    for (const l of this.listeners) {
      try { l(e); } catch { /* listener errors are the listener's problem */ }
    }
    void insertPositionEvent({
      horizon: e.horizon,
      ts: new Date(e.ts).toISOString(),
      event_kind: e.reason === "partial-fill" ? "partial-fill" : e.kind,
      symbol: e.symbol,
      qty: e.qty,
      fill_price: e.fillPrice,
      reason: e.reason,
      pnl_bps: e.pnlBps,
      position_pct: e.positionPct,
    });
    if (e.kind === "exit") {
      this.lastExit.set(e.symbol, e.ts);
      recordExit(e.symbol);
    }
  }

  private logOrder(row: {
    symbol: string; side: "buy" | "sell";
    order_type: "bracket" | "limit" | "market" | "close" | "repair";
    qty: number; reason: string; alpaca_order_id: string;
    status: "submitted" | "filled" | "partial" | "canceled" | "error";
    limit_price?: number | null; stop_price?: number | null; target_price?: number | null;
    expected_price?: number | null; fill_price?: number | null; slippage_bps?: number | null;
  }): void {
    void insertTraderOrder({
      horizon: this.cfg.horizon,
      submitted_at: new Date().toISOString(),
      limit_price: null, stop_price: null, target_price: null,
      expected_price: null, fill_price: null, slippage_bps: null,
      ...row,
    });
  }

  // Held-position stop/target anchored to the actual fill price. Row levels
  // are 0 for non-BUY rows and MUST NOT be used for held decisions.
  private heldLevels(row: ScanRow, pos: PositionState) {
    return computeStopTarget({
      ref: pos.avgPrice,
      volAnn: row.volAnn,
      holdingDays: Math.max(1, this.horizonMin / 390),
      composite: row.composite,
      confidence: row.confidence,
      currentPrice: row.price,
      spreadBps: row.spreadBps,
      calib: this.calib,
    });
  }

  private sellFor(row: ScanRow, pos: PositionState) {
    const st = this.heldLevels(row, pos);
    return {
      levels: st,
      result: sellDecision({
        price: row.price,
        stop: st.stop,
        target: st.fairValueTarget,
        composite: row.composite,
        isMember: row.decision === "BUY" || row.decision === "WAIT",
        isRetained: row.role === "retained",
      }),
    };
  }

  // ---- cycle ---------------------------------------------------------------

  private async cycle(): Promise<void> {
    if (this.cycling) { this.scheduleNext(); return; }
    this.cycling = true;
    const start = Date.now();
    let entries = 0, exits = 0, errors = 0;
    let cycleRan = false;
    try {
      const { session, etHour } = etSession();
      if (session === "closed") return;
      cycleRan = true;

      const snap = await getLatestSnapshot(this.cfg.horizon);
      if (isStale(snap.generatedAt, STALE_SCAN_MS)) {
        console.warn(`[trader:${this.cfg.horizon}] stale scan (${snap.generatedAt}) — skipping cycle`);
        return;
      }
      const bySym = new Map(snap.rows.map((r) => [r.symbol, r]));

      // §2 steps 1-3: sync account, positions, open orders.
      this.account = await this.cfg.broker.getAccount();
      this.positions = await this.cfg.broker.getPositions();
      this.openOrders = await this.cfg.broker.getOpenOrders();
      for (const [sym] of this.closing) {
        if (!this.positions.has(sym)) this.closing.delete(sym);
      }

      // §2 step 4: reconcile fills against the previous cycle's positions.
      exits += this.reconcileFills();
      this.prevPositions = new Map(this.positions);

      // §12: repair pass — heal broker-state drift before acting.
      await this.repairPass();

      const ext = session === "premarket" || session === "afterhours";

      // §2 step 5: SELLS.
      exits += await this.runSells(bySym, session, ext);

      // §2 step 6: re-attach missing exit legs (RTH only).
      if (!ext) await this.reattachExits(bySym);

      // §2 steps 7-8: BUYS + ROTATIONS (Task 7).
      entries += (await this.buyAndRotate(snap.rows, bySym, session, etHour, ext)).entries;
    } catch (err) {
      errors++;
      const msg = err instanceof BrokerError ? err.message : String(err);
      recordError({ kind: "alpaca", message: `[trader:${this.cfg.horizon}] cycle failed: ${msg}` });
    } finally {
      if (cycleRan) this.lastCycleAt = Date.now();
      recordTraderCycle(this.cfg.horizon, Date.now() - start, entries, exits, errors);
      this.cycling = false;
      this.scheduleNext();
    }
  }

  // Diff current vs previous positions → entry/exit events. First cycle after
  // boot treats Alpaca state as authoritative (no synthetic events).
  private reconcileFills(): number {
    let exits = 0;
    if (this.prevPositions === null) {
      this.pendingEntries.clear();
      for (const sym of this.positions.keys()) {
        if (!this.entryTs.has(sym)) this.entryTs.set(sym, Date.now());
      }
      return 0;
    }
    const equity = Math.max(1, this.account.equity);

    for (const [sym, pos] of this.positions) {
      const prev = this.prevPositions.get(sym);
      const tracked = this.pendingEntries.get(sym);
      if (!prev) {
        // New position → entry event. Partial if tracked target > actual.
        const partial = tracked !== undefined && pos.qty < tracked.targetQty;
        if (tracked && tracked.expectedPrice > 0 && pos.avgPrice > 0) {
          const slip = ((pos.avgPrice - tracked.expectedPrice) / tracked.expectedPrice) * 10_000;
          recordSlippage(sym, "buy", tracked.sessionPhase, slip);
          this.logOrder({
            symbol: sym, side: "buy", order_type: "bracket",
            qty: pos.qty, reason: partial ? "partial-fill" : "fill",
            alpaca_order_id: tracked.orderId,
            status: partial ? "partial" : "filled",
            expected_price: tracked.expectedPrice, fill_price: pos.avgPrice,
            slippage_bps: Math.round(slip * 10) / 10,
          });
        }
        this.emit({
          horizon: this.cfg.horizon, ts: Date.now(),
          kind: tracked?.rotation ? "rotation" : "entry",
          symbol: sym, qty: pos.qty, fillPrice: pos.avgPrice,
          reason: partial ? "partial-fill" : (tracked?.rotation ? "rotation-entry" : "entry"),
          pnlBps: null, positionPct: pos.marketValue / equity,
        });
        this.pendingEntries.delete(sym);
      } else if (pos.qty > prev.qty) {
        // Qty increase (bracket top-up etc.) → entry event with delta.
        this.emit({
          horizon: this.cfg.horizon, ts: Date.now(), kind: "entry",
          symbol: sym, qty: pos.qty - prev.qty, fillPrice: pos.avgPrice,
          reason: "qty-increase", pnlBps: null,
          positionPct: pos.marketValue / equity,
        });
      }
    }

    for (const [sym, prev] of this.prevPositions) {
      if (this.positions.has(sym)) continue;
      // Position gone → exit event. Best-effort PnL from last-seen unrealized.
      this.emit({
        horizon: this.cfg.horizon, ts: Date.now(), kind: "exit",
        symbol: sym, qty: prev.qty, fillPrice: prev.currentPrice,
        reason: "exit", pnlBps: Math.round(prev.unrealizedPlPct * 10_000),
        positionPct: 0,
      });
      exits++;
    }
    return exits;
  }

  // §12 repair pass: orphaned sells, duplicate sells, stale buys on held names.
  private async repairPass(): Promise<void> {
    const sellsBySym = new Map<string, OpenOrder[]>();
    for (const o of this.openOrders) {
      if (o.side !== "sell") continue;
      const arr = sellsBySym.get(o.symbol) ?? [];
      arr.push(o);
      sellsBySym.set(o.symbol, arr);
    }
    for (const [sym, orders] of sellsBySym) {
      if (!this.positions.has(sym)) {
        // Orphaned sell: no position behind it.
        await this.safeCancel(sym, "repair-orphan");
      } else if (orders.length > 1) {
        // Duplicate sell coverage: clear all; reattachExits re-arms this cycle.
        await this.safeCancel(sym, "repair-duplicate");
      }
    }
    for (const o of this.openOrders) {
      if (o.side === "buy" && this.positions.has(o.symbol)) {
        // Stale buy on a held name would double exposure on fill (§13).
        await this.safeCancel(o.symbol, "repair-stale-buy");
      }
    }
  }

  private async safeCancel(symbol: string, reason: string): Promise<void> {
    try {
      await this.cfg.broker.cancelOrdersFor(symbol);
      this.openOrders = this.openOrders.filter((o) => o.symbol !== symbol);
      this.logOrder({
        symbol, side: "sell", order_type: "repair", qty: 0,
        reason, alpaca_order_id: "", status: "canceled",
      });
    } catch (err) {
      recordError({ kind: "alpaca", message: `[trader:${this.cfg.horizon}] ${reason} cancel ${symbol} failed: ${err}` });
    }
  }

  private async runSells(
    bySym: Map<string, ScanRow>, session: TraderSession, ext: boolean,
  ): Promise<number> {
    let exits = 0;
    for (const [sym, pos] of this.positions) {
      const closingTs = this.closing.get(sym) ?? 0;
      if (Date.now() - closingTs < CLOSING_TOMBSTONE_MS) continue;
      const row = bySym.get(sym);
      if (!row || !row.price) continue;
      const { levels, result } = this.sellFor(row, pos);

      if (!ext) {
        // Regular hours: bracket legs own stop/target; runner closes at
        // market on any sellDecision SELL (signal exits + level safety net).
        if (result.decision !== "SELL") continue;
        const res = await this.cfg.broker.closePosition(sym);
        if (res !== null) {
          this.closing.set(sym, Date.now());
          this.lastExit.set(sym, Date.now());
          this.logOrder({
            symbol: sym, side: "sell", order_type: "close", qty: pos.qty,
            reason: `sell-${result.reason}`, alpaca_order_id: res.orderId,
            status: "submitted", expected_price: row.price,
          });
          exits++;
        }
      } else {
        // Extended session: legs don't run — watch widened levels, exit via
        // marketable extended limit.
        const extStop = levels.stop * (1 - this.cfg.extendedSettings.stopWiden);
        const extTarget = levels.fairValueTarget * (1 + this.cfg.extendedSettings.targetWiden);
        const signalExit =
          result.decision === "SELL" &&
          (result.reason === "reversal" || result.reason === "deteriorated");
        const stopHit = levels.stop > 0 && row.price <= extStop;
        const targetHit = levels.fairValueTarget > 0 && row.price >= extTarget;
        if (!(signalExit || stopHit || targetHit)) continue;
        if (Math.floor(pos.qty) < 1) continue; // extended rejects fractional
        const limit = roundPrice(row.price * (1 - this.cfg.extendedSettings.limitSlip));
        try {
          await this.cfg.broker.cancelOrdersFor(sym);
          await new Promise((r) => setTimeout(r, 250));
          const o = await this.cfg.broker.submitLimit({
            symbol: sym, side: "sell", qty: Math.floor(pos.qty),
            limitPrice: limit, extended: true,
          });
          this.closing.set(sym, Date.now());
          this.lastExit.set(sym, Date.now());
          this.logOrder({
            symbol: sym, side: "sell", order_type: "limit", qty: Math.floor(pos.qty),
            reason: signalExit ? `ext-signal-${result.reason}` : stopHit ? "ext-stop" : "ext-target",
            alpaca_order_id: o.orderId, status: "submitted",
            limit_price: limit, expected_price: row.price,
          });
          exits++;
        } catch (err) {
          recordError({ kind: "alpaca", message: `[trader:${this.cfg.horizon}] ext exit ${sym} (${session}) failed: ${err}` });
        }
      }
    }
    return exits;
  }

  // §2 step 6: any held position with no open sell coverage gets a fresh OCO.
  private async reattachExits(bySym: Map<string, ScanRow>): Promise<void> {
    const covered = new Set(
      this.openOrders.filter((o) => o.side === "sell").map((o) => o.symbol),
    );
    for (const [sym, pos] of this.positions) {
      if (covered.has(sym)) continue;
      if (Date.now() - (this.closing.get(sym) ?? 0) < CLOSING_TOMBSTONE_MS) continue;
      const row = bySym.get(sym);
      if (!row || !row.price) continue;
      const st = this.heldLevels(row, pos);
      const br = sanitizeBracket(row.price, st.stop, st.takeProfitLimit);
      if (br === null) continue; // unfixable levels — skip (spec §2 step 6)
      const stopLimit = roundPrice(Math.min(st.stopLimit, br.stop));
      try {
        const o = await this.cfg.broker.submitOco({
          symbol: sym, qty: Math.floor(pos.qty),
          stopPrice: br.stop, stopLimitPrice: stopLimit, takeProfitLimit: br.target,
        });
        this.openOrders.push({
          id: o.orderId, symbol: sym, side: "sell", orderType: "limit",
          qty: Math.floor(pos.qty), limitPrice: br.target, stopPrice: br.stop,
          submittedAt: new Date().toISOString(),
        });
        this.logOrder({
          symbol: sym, side: "sell", order_type: "limit", qty: Math.floor(pos.qty),
          reason: "reattach-oco", alpaca_order_id: o.orderId, status: "submitted",
          stop_price: br.stop, target_price: br.target,
        });
      } catch (err) {
        recordError({ kind: "alpaca", message: `[trader:${this.cfg.horizon}] OCO re-attach ${sym} failed: ${err}` });
      }
    }
  }

  // §2 steps 7-8: BUYS then ROTATIONS. Returns entry count for cycle stats.
  private async buyAndRotate(
    rows: ScanRow[], bySym: Map<string, ScanRow>,
    session: TraderSession, etHour: number, ext: boolean,
  ): Promise<{ entries: number }> {
    // Session gates (§2 step 7).
    if (session === "afterhours") return { entries: 0 };
    if (session === "premarket" && etHour < this.cfg.sessionSettings.premarketMinHour) {
      return { entries: 0 };
    }

    const s = this.cfg.settings;
    const now = Date.now();
    const openBuySyms = new Set(
      this.openOrders.filter((o) => o.side === "buy").map((o) => o.symbol),
    );

    // Starred BUY rows, not held/pending, valid levels, past reversal cooldown.
    const candidates = rows
      .filter((r) =>
        r.decision === "BUY" && r.star &&
        !this.positions.has(r.symbol) &&
        !this.pendingEntries.has(r.symbol) &&
        !openBuySyms.has(r.symbol) &&
        r.price > 0 && r.stopPx > 0 && r.takeProfitLimitPx > 0 &&
        now - (this.lastExit.get(r.symbol) ?? 0) >= s.reversalCooldownS * 1000,
      )
      .sort((a, b) => b.net - a.net);

    let entries = 0;

    // ---- ROTATIONS first (RTH only): freed cash funds the incoming buy ----
    if (!ext && candidates.length > 0) {
      let rotations = 0;
      const usedTargets = new Set<string>();
      const heldRows = [...this.positions.keys()]
        .map((sym) => bySym.get(sym))
        .filter((r): r is ScanRow => r !== undefined)
        .sort((a, b) => a.net - b.net); // weakest first

      for (const heldRow of heldRows) {
        if (rotations >= s.maxRotationsPerCycle) break;
        const sym = heldRow.symbol;
        const pos = this.positions.get(sym);
        if (!pos) continue;
        if (heldRow.role === "primary" || heldRow.role === "secondary") continue;
        if (now - (this.closing.get(sym) ?? 0) < CLOSING_TOMBSTONE_MS) continue;
        if (now - (this.entryTs.get(sym) ?? 0) < s.rotationMinAgeS * 1000) continue;
        const { result } = this.sellFor(heldRow, pos);
        if (result.decision !== "HOLD") continue; // SELL path already handled it

        const targets = candidates
          .filter((c) => !usedTargets.has(c.symbol))
          .map((c) => ({
            symbol: c.symbol, role: c.role, netBps: c.net, entryCostBps: c.cost,
          }));
        if (targets.length === 0) break;
        const best = scoreRotations(
          {
            symbol: sym, role: heldRow.role,
            netBps: Math.max(0, heldRow.net),
            modelEdgeBps: heldRow.modelEdge,
            exitCostBps: heldRow.cExit,
          },
          targets,
        )[0];
        if (!best || !best.cleared) continue;
        const cand = bySym.get(best.toSymbol);
        if (!cand) continue;

        // §65 package budget: freed cash after modeled exit cost + spare cash
        // above the floor.
        const freedCash = pos.qty * heldRow.price * (1 - Math.max(0, heldRow.cExit) / 10_000);
        const spareCash = Math.max(0, this.account.buyingPower - this.account.equity * s.cashFloorPct);
        const budget = freedCash + spareCash;
        const conviction = (s.minConviction + s.maxConviction) / 2;
        const qty = sizePosition({
          equity: this.account.equity, buyingPower: this.account.buyingPower,
          price: cand.price, stop: cand.stopPx, conviction,
          cashAvailable: budget, settings: s,
        });
        if (qty < 1) continue;
        const br = sanitizeBracket(cand.price, cand.stopPx, cand.takeProfitLimitPx);
        if (br === null) continue;

        try {
          const closed = await this.cfg.broker.closePosition(sym);
          if (closed === null) continue;
          this.closing.set(sym, now);
          this.lastExit.set(sym, now);
          this.logOrder({
            symbol: sym, side: "sell", order_type: "close", qty: pos.qty,
            reason: `rotate-out→${cand.symbol}`, alpaca_order_id: closed.orderId,
            status: "submitted", expected_price: heldRow.price,
          });
          const o = await this.cfg.broker.submitBracket({
            symbol: cand.symbol, qty, stopPrice: br.stop,
            stopLimitPrice: roundPrice(Math.min(cand.stopLimitPx, br.stop)),
            takeProfitLimit: br.target,
          });
          this.pendingEntries.set(cand.symbol, {
            targetQty: qty, expectedPrice: cand.price, orderId: o.orderId,
            sessionPhase: ext ? "extended" : "regular", rotation: true,
          });
          this.entryTs.set(cand.symbol, now);
          usedTargets.add(cand.symbol);
          this.logOrder({
            symbol: cand.symbol, side: "buy", order_type: "bracket", qty,
            reason: `rotate-in←${sym}`, alpaca_order_id: o.orderId,
            status: "submitted", stop_price: br.stop, target_price: br.target,
            expected_price: cand.price,
          });
          rotations++;
          entries++;
        } catch (err) {
          recordError({ kind: "alpaca", message: `[trader:${this.cfg.horizon}] rotation ${sym}→${cand.symbol} failed: ${err}` });
        }
      }
      // Rotated-in symbols can't also be fresh entries this cycle.
      for (const t of usedTargets) {
        const idx = candidates.findIndex((c) => c.symbol === t);
        if (idx >= 0) candidates.splice(idx, 1);
      }
    }

    // ---- BUYS ----
    const n = candidates.length;
    let bought = 0;
    for (let i = 0; i < n; i++) {
      if (bought >= s.maxEntriesPerCycle) break;
      if (this.positions.size + this.pendingEntries.size >= s.maxPositions) break;
      const r = candidates[i];
      const br = sanitizeBracket(r.price, r.stopPx, r.takeProfitLimitPx);
      if (br === null) continue;
      const conviction = convictionForRank(i + 1, n, s);
      const qty = sizePosition({
        equity: this.account.equity, buyingPower: this.account.buyingPower,
        price: r.price, stop: br.stop, conviction, settings: s,
      });
      if (qty < 1) continue;

      try {
        let orderId: string;
        let orderType: "bracket" | "limit";
        if (!ext) {
          const o = await this.cfg.broker.submitBracket({
            symbol: r.symbol, qty, stopPrice: br.stop,
            stopLimitPrice: roundPrice(Math.min(r.stopLimitPx, br.stop)),
            takeProfitLimit: br.target,
          });
          orderId = o.orderId;
          orderType = "bracket";
        } else {
          // Premarket ≥ min hour: extended marketable limit buy; exit legs
          // re-attach at the first regular-hours cycle.
          const limit = roundPrice(r.price * (1 + this.cfg.extendedSettings.limitSlip));
          const o = await this.cfg.broker.submitLimit({
            symbol: r.symbol, side: "buy", qty, limitPrice: limit, extended: true,
          });
          orderId = o.orderId;
          orderType = "limit";
        }
        this.pendingEntries.set(r.symbol, {
          targetQty: qty, expectedPrice: r.price, orderId,
          sessionPhase: ext ? "extended" : "regular", rotation: false,
        });
        this.entryTs.set(r.symbol, now);
        this.logOrder({
          symbol: r.symbol, side: "buy", order_type: orderType, qty,
          reason: "star-entry", alpaca_order_id: orderId, status: "submitted",
          stop_price: br.stop, target_price: br.target, expected_price: r.price,
        });
        bought++;
        entries++;
      } catch (err) {
        recordError({ kind: "alpaca", message: `[trader:${this.cfg.horizon}] BUY ${r.symbol} failed: ${err}` });
      }
    }

    return { entries };
  }
}
