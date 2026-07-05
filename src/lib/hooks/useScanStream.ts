"use client";

import { useEffect, useRef, useState } from "react";
import type { ScanRow, ScanSnapshot } from "@/lib/engine/types";

export type ScanStreamStatus = "idle" | "connecting" | "live" | "polling" | "error";

// Per-symbol time series of a few key metrics across recent snapshots.
// Newest sample is the last element. Kept short on purpose — these get
// rendered in dense sparklines, not full charts.
export interface SymbolHistorySample {
  ts: number;     // ms epoch when the snapshot arrived
  mu: number;     // bps
  evidence: number;
  net: number;    // bps
  composite: number;
}

export interface UseScanStreamResult {
  snapshot: ScanSnapshot | null;
  prevSnapshot: ScanSnapshot | null;        // previous full snapshot (for movers)
  status: ScanStreamStatus;
  lastUpdate: number | null;
  history: Map<string, SymbolHistorySample[]>;
}

const POLL_MS = 5_000;
const HISTORY_LEN = 30;   // ~last 30 snapshots ≈ 2.5min at 5s SSE tick

/**
 * Subscribes to /api/scan/stream (SSE, event `snapshot`).
 * Falls back to polling /api/scan every 5s if SSE drops or errors.
 * Also accumulates a short per-symbol history for sparklines + mover detection.
 *
 * `horizon` optionally overrides the server default (?h= query param). When it
 * changes, the SSE + polling loops tear down and restart against the new
 * horizon so the client always sees a coherent snapshot.
 */
export function useScanStream(horizon?: string): UseScanStreamResult {
  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null);
  const [prevSnapshot, setPrevSnapshot] = useState<ScanSnapshot | null>(null);
  const [status, setStatus] = useState<ScanStreamStatus>("idle");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  // History lives in a ref so we can update without re-rendering for every push;
  // we expose a stable Map reference. Consumers that want reactive updates can
  // depend on `lastUpdate`.
  const historyRef = useRef<Map<string, SymbolHistorySample[]>>(new Map());

  const sseRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Horizon just changed — dump the previous snapshot so the UI doesn't
  // render a stale one against the newly-selected horizon's overlays.
  // React docs' "adjusting state when a prop changes" pattern: setState
  // during render is allowed for a same-component prop-derived reset.
  // NB: historyRef is left alone. It's keyed by symbol, not horizon; stale
  // samples roll off within HISTORY_LEN pushes as new snapshots arrive.
  const [prevHorizon, setPrevHorizon] = useState(horizon);
  if (horizon !== prevHorizon) {
    setPrevHorizon(horizon);
    setSnapshot(null);
    setPrevSnapshot(null);
    setStatus("connecting");
  }

  useEffect(() => {
    let cancelled = false;

    const stopPolling = () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const pushHistory = (rows: readonly ScanRow[], ts: number) => {
      const h = historyRef.current;
      for (const r of rows) {
        const arr = h.get(r.symbol) ?? [];
        arr.push({ ts, mu: r.mu, evidence: r.evidence, net: r.net, composite: r.composite });
        if (arr.length > HISTORY_LEN) arr.shift();
        h.set(r.symbol, arr);
      }
    };

    const applySnapshot = (data: unknown) => {
      if (cancelled) return;
      if (
        data &&
        typeof data === "object" &&
        "rows" in data &&
        Array.isArray((data as ScanSnapshot).rows)
      ) {
        const snap = data as ScanSnapshot;
        const ts = Date.now();
        pushHistory(snap.rows, ts);
        setSnapshot((prev) => {
          setPrevSnapshot(prev);
          return snap;
        });
        setLastUpdate(ts);
      }
    };

    // Build a URL that carries the horizon override (if any).
    const withHorizon = (path: string) => {
      if (!horizon) return path;
      const sep = path.includes("?") ? "&" : "?";
      return `${path}${sep}h=${encodeURIComponent(horizon)}`;
    };

    const startPolling = async () => {
      if (cancelled || pollTimerRef.current) return;
      setStatus("polling");
      const tick = async () => {
        try {
          const res = await fetch(withHorizon("/api/scan"), { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as ScanSnapshot;
          applySnapshot(json);
        } catch {
          setStatus("error");
        }
      };
      void tick();
      pollTimerRef.current = setInterval(() => void tick(), POLL_MS);
    };

    const startSse = () => {
      if (cancelled) return;
      setStatus("connecting");
      try {
        const es = new EventSource(withHorizon("/api/scan/stream"));
        sseRef.current = es;

        es.addEventListener("snapshot", (evt) => {
          if (cancelled) return;
          stopPolling();
          setStatus("live");
          try {
            const data = JSON.parse((evt as MessageEvent).data) as unknown;
            applySnapshot(data);
          } catch {
            /* malformed payload — ignore */
          }
        });

        es.onerror = () => {
          if (!snapshot) {
            void startPolling();
          }
          setStatus((prev) => (prev === "live" ? "polling" : prev));
        };
      } catch {
        void startPolling();
      }
    };

    if (typeof window !== "undefined" && "EventSource" in window) {
      startSse();
      fallbackTimerRef.current = setTimeout(() => {
        if (!cancelled && !snapshot) void startPolling();
      }, 4_000);
    } else {
      void startPolling();
    }

    return () => {
      cancelled = true;
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      stopPolling();
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon]);

  return {
    snapshot,
    prevSnapshot,
    status,
    lastUpdate,
    history: historyRef.current,
  };
}
