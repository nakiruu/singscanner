"use client";

import { useEffect, useState } from "react";
import type { AdminSummary } from "@/app/api/admin/summary/route";

const POLL_MS = 12_000;

export function useSummaryPolling() {
  const [data, setData] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchOnce = async () => {
      try {
        const r = await fetch("/api/admin/summary", { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const json = (await r.json()) as AdminSummary;
        if (!alive) return;
        setData(json);
        setError(null);
        setRefreshedAt(Date.now());
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
  }, []);

  return { data, loading, error, refreshedAt };
}
