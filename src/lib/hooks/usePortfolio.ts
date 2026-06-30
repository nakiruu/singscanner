"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AddPositionInput,
  PortfolioEntry,
  UpdatePositionInput,
} from "@/lib/portfolio/types";

export interface UsePortfolioResult {
  positions: PortfolioEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addPosition: (input: AddPositionInput) => Promise<void>;
  updatePosition: (symbol: string, patch: UpdatePositionInput) => Promise<void>;
  removePosition: (symbol: string) => Promise<void>;
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function usePortfolio(): UsePortfolioResult {
  const [positions, setPositions] = useState<PortfolioEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as PortfolioEntry[];
      setPositions(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load portfolio");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addPosition = useCallback(
    async (input: AddPositionInput) => {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: input.symbol.toUpperCase(),
          qty: input.qty,
          costBasis: input.costBasis,
          notes: input.notes ?? null,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      await refresh();
    },
    [refresh],
  );

  const updatePosition = useCallback(
    async (symbol: string, patch: UpdatePositionInput) => {
      const res = await fetch(`/api/portfolio/${encodeURIComponent(symbol.toUpperCase())}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await readError(res));
      await refresh();
    },
    [refresh],
  );

  const removePosition = useCallback(
    async (symbol: string) => {
      const res = await fetch(`/api/portfolio/${encodeURIComponent(symbol.toUpperCase())}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readError(res));
      await refresh();
    },
    [refresh],
  );

  return { positions, loading, error, refresh, addPosition, updatePosition, removePosition };
}
