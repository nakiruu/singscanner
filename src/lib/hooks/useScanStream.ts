"use client";

import { useEffect, useRef, useState } from "react";
import type { ScanSnapshot } from "@/lib/engine/types";

export type ScanStreamStatus = "idle" | "connecting" | "live" | "polling" | "error";

export interface UseScanStreamResult {
  snapshot: ScanSnapshot | null;
  status: ScanStreamStatus;
  lastUpdate: number | null;
}

const POLL_MS = 5_000;

/**
 * Subscribes to /api/scan/stream (SSE, event `snapshot`).
 * Falls back to polling /api/scan every 5s if SSE drops or errors.
 */
export function useScanStream(): UseScanStreamResult {
  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null);
  const [status, setStatus] = useState<ScanStreamStatus>("idle");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  const sseRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const stopPolling = () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const applySnapshot = (data: unknown) => {
      if (cancelled) return;
      // Light-weight runtime guard. We trust the API shape (matches ScanSnapshot).
      if (
        data &&
        typeof data === "object" &&
        "rows" in data &&
        Array.isArray((data as ScanSnapshot).rows)
      ) {
        setSnapshot(data as ScanSnapshot);
        setLastUpdate(Date.now());
      }
    };

    const startPolling = async () => {
      if (cancelled || pollTimerRef.current) return;
      setStatus("polling");
      const tick = async () => {
        try {
          const res = await fetch("/api/scan", { cache: "no-store" });
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
        const es = new EventSource("/api/scan/stream");
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
          // Browser will auto-retry. If we have no data yet, kick polling so the UI lights up.
          if (!snapshot) {
            void startPolling();
          }
          setStatus((prev) => (prev === "live" ? "polling" : prev));
        };
      } catch {
        void startPolling();
      }
    };

    // Prefer SSE if EventSource is available.
    if (typeof window !== "undefined" && "EventSource" in window) {
      startSse();
      // Safety net: if no snapshot in 4s, start polling alongside.
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
  }, []);

  return { snapshot, status, lastUpdate };
}
