"use client";

import { useEffect, useState } from "react";
import type { AdminActivityEvent } from "@/app/api/admin/activity/route";

const POLL_MS = 12_000;

export function useActivityPolling(enabled: boolean, limit = 50) {
  const [events, setEvents] = useState<AdminActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const fetchOnce = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/admin/activity?limit=${limit}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const json = (await r.json()) as { events: AdminActivityEvent[] };
        if (!alive) return;
        setEvents(json.events);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "unknown");
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchOnce();
    const t = setInterval(fetchOnce, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [enabled, limit]);

  return { events, loading, error };
}
