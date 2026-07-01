"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export interface WatchlistItem {
  symbol: string;
  notes: string | null;
  createdAt: string;
}

interface WatchlistApiEntry {
  symbol: string;
  notes: string | null;
  createdAt: string;
}

export interface UseWatchlistResult {
  watchlist: WatchlistItem[];
  symbolSet: Set<string>;
  loading: boolean;
  error: string | null;
  toggle: (symbol: string) => Promise<void>;
  refresh: () => Promise<void>;
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function useWatchlist(): UseWatchlistResult {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/watchlist", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as WatchlistApiEntry[];
      setWatchlist(
        data.map((e) => ({
          symbol: e.symbol,
          notes: e.notes,
          createdAt: e.createdAt,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load watchlist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const symbolSet = useMemo(
    () => new Set(watchlist.map((w) => w.symbol)),
    [watchlist],
  );

  const toggle = useCallback(
    async (symbol: string) => {
      const upper = symbol.trim().toUpperCase();
      if (!upper) return;
      const isStarred = symbolSet.has(upper);
      const res = isStarred
        ? await fetch(`/api/watchlist/${encodeURIComponent(upper)}`, {
            method: "DELETE",
          })
        : await fetch("/api/watchlist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ symbol: upper }),
          });
      if (!res.ok) throw new Error(await readError(res));
      await refresh();
    },
    [symbolSet, refresh],
  );

  return { watchlist, symbolSet, loading, error, toggle, refresh };
}
