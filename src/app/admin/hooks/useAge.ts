"use client";

import { useEffect, useState } from "react";

// Returns seconds since `ts` (server-provided ms epoch). Ticks every 1s.
// Returns null when ts is null.
export function useAge(ts: number | null): number | null {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (ts == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ts]);
  if (ts == null) return null;
  return Math.max(0, Math.floor((now - ts) / 1000));
}
