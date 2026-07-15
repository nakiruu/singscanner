// HorizonICLadder — admin card for per-family per-horizon IC + alpha-decay τ.
//
// Reads two data sources:
//   - GET /api/admin/family-ic       (from src/lib/data/family-ic.ts, B6-S5)
//   - GET /api/admin/alpha-decay     (from src/lib/data/alpha-decay.ts, C7-2)
//
// The ladder view is a 4-family × 3-horizon grid of IC values plus a
// per-family τ column. Enables visual detection of family retirement
// candidates (Israel & Moskowitz 2013 JFE) — τ < 3 trading days is
// flagged as retirement-territory.
//
// Fetches are lazy (on-mount); no polling to keep admin bandwidth
// minimal. Users refresh via /admin route reload.

"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Horizon = "3d" | "5d" | "10d";
type SignalFamily = "momentum" | "quality" | "liquidity" | "risk";

interface FamilyICPoint {
  family: SignalFamily;
  horizon: Horizon;
  n: number;
  ic: number;
  icTStat: number;
  significant: boolean;
}

interface FamilyICReport {
  generatedAt: string;
  windowDays: number;
  points: FamilyICPoint[];
}

interface AlphaDecayPoint {
  family: SignalFamily;
  tauDays: number;
  ic0: number;
  nHorizons: number;
  fitR2: number;
  retirementCandidate: boolean;
}

interface AlphaDecayReport {
  generatedAt: string;
  windowDays: number;
  points: AlphaDecayPoint[];
}

const FAMILIES: SignalFamily[] = ["momentum", "quality", "liquidity", "risk"];
const HORIZONS: Horizon[] = ["3d", "5d", "10d"];

export function HorizonICLadder() {
  const [ic, setIc] = useState<FamilyICReport | null>(null);
  const [decay, setDecay] = useState<AlphaDecayReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [icRes, decayRes] = await Promise.all([
          fetch("/api/admin/family-ic").then((r) => r.json()),
          fetch("/api/admin/alpha-decay").then((r) => r.json()),
        ]);
        setIc(icRes);
        setDecay(decayRes);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>▸ Horizon IC ladder</CardTitle>
        {ic && (
          <span className="font-mono text-[10px] text-on-surface-variant">
            {ic.windowDays}d window · updated {ic.generatedAt.slice(11, 19)}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {error && (
          <div className="font-mono text-[11px] text-error">error: {error}</div>
        )}
        {!ic && !error && (
          <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>
        )}
        {ic && (
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="border-b border-border/50 text-on-surface-variant">
                <th className="pb-1 text-left">Family</th>
                {HORIZONS.map((h) => (
                  <th key={h} className="pb-1 text-right">IC({h})</th>
                ))}
                <th className="pb-1 text-right">τ (days)</th>
                <th className="pb-1 text-right">R²</th>
              </tr>
            </thead>
            <tbody>
              {FAMILIES.map((f) => {
                const rowIcs = HORIZONS.map((h) =>
                  ic.points.find((p) => p.family === f && p.horizon === h),
                );
                const tauPoint = decay?.points.find((p) => p.family === f);
                return (
                  <tr key={f} className="border-t border-border/50">
                    <td className="py-1 text-on-surface capitalize">{f}</td>
                    {rowIcs.map((p, i) => (
                      <td
                        key={i}
                        className={
                          p == null
                            ? "text-right text-on-surface-variant"
                            : p.significant
                              ? "text-right font-semibold text-on-surface"
                              : "text-right text-on-surface-variant"
                        }
                      >
                        {p == null ? "—" : p.ic.toFixed(3)}
                      </td>
                    ))}
                    <td
                      className={
                        tauPoint?.retirementCandidate
                          ? "text-right font-semibold text-error"
                          : "text-right text-on-surface"
                      }
                    >
                      {tauPoint == null || !Number.isFinite(tauPoint.tauDays)
                        ? "—"
                        : tauPoint.tauDays.toFixed(1)}
                    </td>
                    <td className="text-right text-on-surface-variant">
                      {tauPoint == null ? "—" : tauPoint.fitR2.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="mt-2 font-mono text-[10px] text-on-surface-variant">
          Bold IC = |t-stat| &gt; 2 significance · red τ = retirement candidate
          (&lt;3d). Israel &amp; Moskowitz (2013): retire when rolling 6m IC
          drops &lt; 50% of baseline.
        </div>
      </CardContent>
    </Card>
  );
}
