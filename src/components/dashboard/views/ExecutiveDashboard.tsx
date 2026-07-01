"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Coins,
  Database,
  Layers,
  Radio,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Decision, ScanRow, ScanSnapshot } from "@/lib/engine/types";

export interface ExecutiveDashboardProps {
  snapshot: ScanSnapshot | null;
  prevSnapshot?: ScanSnapshot | null;
  status?: string;
  lastUpdate?: number | null;
}

// -- helpers -----------------------------------------------------------------

const DECISION_COLORS: Record<Decision, string> = {
  BUY: "bg-primary",
  WAIT: "bg-tertiary",
  HOLD: "bg-[#4F9DF0]",
  "HOLD-CASH": "bg-[#4F9DF0]",
  SELL: "bg-error",
};

const DECISION_TEXT_COLORS: Record<Decision, string> = {
  BUY: "text-primary",
  WAIT: "text-tertiary",
  HOLD: "text-[#4F9DF0]",
  "HOLD-CASH": "text-[#4F9DF0]",
  SELL: "text-error",
};

interface StatusVisual {
  text: string;
  dot: string;
  pulse: boolean;
}

function statusVisual(status: string | undefined): StatusVisual {
  switch (status) {
    case "live":
      return { text: "LIVE", dot: "bg-primary", pulse: true };
    case "polling":
      return { text: "POLLING", dot: "bg-tertiary", pulse: false };
    case "connecting":
      return { text: "CONNECTING", dot: "bg-tertiary", pulse: true };
    case "error":
      return { text: "ERROR", dot: "bg-error", pulse: false };
    case "idle":
    default:
      return { text: "IDLE", dot: "bg-on-surface-variant", pulse: false };
  }
}

function formatAgo(ts: number | null | undefined, now: number): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function formatCycleTs(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}Z`;
}

function majoritySource(rows: readonly ScanRow[]): string {
  if (rows.length === 0) return "—";
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
  let best = "—";
  let bestN = -1;
  for (const [k, v] of counts) {
    if (v > bestN) {
      bestN = v;
      best = k;
    }
  }
  return best;
}

function formatBps(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)} bps`;
}

// -- subcomponents -----------------------------------------------------------

function PipelineCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-r border-border px-4 py-3 last:border-r-0">
      <span className="label-caps">{label}</span>
      <div className="truncate font-mono text-sm font-semibold tabular-nums text-primary">
        {children}
      </div>
    </div>
  );
}

function PipelineStrip({
  snapshot,
  status,
  lastUpdate,
}: {
  snapshot: ScanSnapshot | null;
  status: string | undefined;
  lastUpdate: number | null | undefined;
}) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const sv = statusVisual(status);
  const rows = snapshot?.rows ?? [];

  return (
    <Card>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
        <div className="flex min-w-0 flex-col gap-1 border-r border-border px-4 py-3">
          <span className="label-caps">Stream</span>
          <div className="flex items-center gap-2 font-mono text-sm font-semibold text-primary">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                sv.dot,
                sv.pulse && "led-pulse"
              )}
            />
            <span>{sv.text}</span>
          </div>
        </div>
        <PipelineCell label="Last Update">
          {formatAgo(lastUpdate ?? null, now)}
        </PipelineCell>
        <PipelineCell label="Universe">{snapshot?.universe ?? "—"}</PipelineCell>
        <PipelineCell label="Horizon">{snapshot?.horizon ?? "—"}</PipelineCell>
        <PipelineCell label="Source">{majoritySource(rows)}</PipelineCell>
        <PipelineCell label="Symbols">
          {(snapshot?.symbolsScanned ?? 0).toLocaleString()}
        </PipelineCell>
        <PipelineCell label="Cycle">
          {formatCycleTs(snapshot?.generatedAt)}
        </PipelineCell>
      </div>
    </Card>
  );
}

function KpiCard({
  label,
  value,
  sub,
  Icon,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  Icon: typeof BarChart3;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <span className="label-caps">{label}</span>
        <Icon className="h-4 w-4 text-on-surface-variant" />
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "font-mono text-3xl font-semibold tabular-nums",
            valueClass ?? "text-primary"
          )}
        >
          {value}
        </div>
        {sub && (
          <div className="mt-1 font-mono text-xs text-on-surface-variant">
            {sub}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KpiRow({ rows }: { rows: readonly ScanRow[] }) {
  const buyRows = rows.filter((r) => r.decision === "BUY");
  const waitRows = rows.filter((r) => r.decision === "WAIT");
  const actionable = buyRows.length + waitRows.length;
  const primary = rows.filter((r) => r.role === "primary").length;
  const secondary = rows.filter((r) => r.role === "secondary").length;

  const avgNet =
    buyRows.length === 0
      ? Number.NaN
      : buyRows.reduce((s, r) => s + r.net, 0) / buyRows.length;
  const avgNetClass = !Number.isFinite(avgNet)
    ? "text-on-surface-variant"
    : avgNet > 0
      ? "text-primary"
      : avgNet < 0
        ? "text-error"
        : "text-on-surface";

  const passed = rows.filter((r) => r.role !== "none").length;
  const total = rows.length;
  const pct = total === 0 ? 0 : (passed / total) * 100;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <KpiCard
        label="Actionable Signals"
        value={actionable.toLocaleString()}
        sub={
          <>
            <span className="text-primary">{primary} primary</span>
            <span className="text-on-surface-variant"> · </span>
            <span className="text-tertiary">{secondary} secondary</span>
          </>
        }
        Icon={Target}
      />
      <KpiCard
        label="Avg Net Surplus (BUYs)"
        value={Number.isFinite(avgNet) ? formatBps(avgNet) : "—"}
        sub={`across ${buyRows.length} BUY rows`}
        Icon={Coins}
        valueClass={avgNetClass}
      />
      <KpiCard
        label="Role Coverage"
        value={`${pct.toFixed(1)}%`}
        sub={
          <span className="label-caps">
            {passed} / {total} rows gated
          </span>
        }
        Icon={Layers}
      />
    </div>
  );
}

// Decision distribution stacked bar + legend
function DecisionDistribution({ rows }: { rows: readonly ScanRow[] }) {
  const counts: Record<Decision, number> = {
    BUY: 0,
    WAIT: 0,
    HOLD: 0,
    "HOLD-CASH": 0,
    SELL: 0,
  };
  for (const r of rows) counts[r.decision] += 1;
  const total = rows.length;

  // Combine HOLD and HOLD-CASH for the bar segments + legend
  const segments: { key: string; label: string; n: number; color: string; text: string }[] = [
    { key: "BUY", label: "BUY", n: counts.BUY, color: "bg-primary", text: "text-primary" },
    { key: "WAIT", label: "WAIT", n: counts.WAIT, color: "bg-tertiary", text: "text-tertiary" },
    {
      key: "HOLD",
      label: "HOLD",
      n: counts.HOLD + counts["HOLD-CASH"],
      color: "bg-[#4F9DF0]",
      text: "text-[#4F9DF0]",
    },
    { key: "SELL", label: "SELL", n: counts.SELL, color: "bg-error", text: "text-error" },
  ];

  return (
    <Card>
      <CardHeader>
        <span className="label-caps flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5" />
          Decision Distribution
        </span>
        <span className="font-mono text-xs text-on-surface-variant tabular-nums">
          n = {total}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex h-6 w-full overflow-hidden rounded-sm border border-border bg-surface-low">
          {total === 0 ? (
            <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-on-surface-variant">
              no data
            </div>
          ) : (
            segments.map((s) =>
              s.n === 0 ? null : (
                <div
                  key={s.key}
                  className={cn("h-full", s.color)}
                  style={{ width: `${(s.n / total) * 100}%` }}
                  title={`${s.label}: ${s.n}`}
                />
              )
            )
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {segments.map((s) => {
            const pct = total === 0 ? 0 : (s.n / total) * 100;
            return (
              <div
                key={s.key}
                className="flex items-center justify-between rounded-sm border border-border bg-surface-low/60 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", s.color)} />
                  <span className={cn("label-caps", s.text)}>{s.label}</span>
                </div>
                <div className="text-right font-mono text-xs tabular-nums">
                  <div className="text-on-surface">{s.n}</div>
                  <div className="text-on-surface-variant">{pct.toFixed(1)}%</div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Net surplus histogram
function NetHistogram({ rows }: { rows: readonly ScanRow[] }) {
  const data = rows.map((r) => r.net).filter((v) => Number.isFinite(v));

  const { bins, min, max, peak } = useMemo(() => {
    if (data.length === 0) {
      return { bins: [] as { x0: number; x1: number; n: number }[], min: 0, max: 0, peak: 0 };
    }
    let mn = data[0];
    let mx = data[0];
    for (const v of data) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn === mx) {
      mn -= 1;
      mx += 1;
    }
    const N = 12;
    const step = (mx - mn) / N;
    const arr: { x0: number; x1: number; n: number }[] = [];
    for (let i = 0; i < N; i++) {
      arr.push({ x0: mn + i * step, x1: mn + (i + 1) * step, n: 0 });
    }
    for (const v of data) {
      let idx = Math.floor((v - mn) / step);
      if (idx >= N) idx = N - 1;
      if (idx < 0) idx = 0;
      arr[idx].n += 1;
    }
    let pk = 0;
    for (const b of arr) if (b.n > pk) pk = b.n;
    return { bins: arr, min: mn, max: mx, peak: pk };
  }, [data]);

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <span className="label-caps flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5" />
          Net Surplus Histogram
        </span>
        <span className="font-mono text-xs text-on-surface-variant tabular-nums">
          n = {data.length}
        </span>
      </CardHeader>
      <CardContent>
        {bins.length === 0 ? (
          <div className="flex h-40 items-center justify-center font-mono text-xs text-on-surface-variant">
            No rows yet.
          </div>
        ) : (
          <>
            <div className="flex h-40 items-end gap-1">
              {bins.map((b, i) => {
                const h = peak === 0 ? 0 : (b.n / peak) * 100;
                const positive = b.x0 + (b.x1 - b.x0) / 2 >= 0;
                return (
                  <div
                    key={i}
                    className="flex flex-1 items-end"
                    title={`${b.x0.toFixed(1)} → ${b.x1.toFixed(1)} bps : ${b.n}`}
                  >
                    <div
                      className={cn(
                        "w-full rounded-t-sm",
                        positive ? "bg-primary/70" : "bg-error/70"
                      )}
                      style={{ height: `${Math.max(2, h)}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] tabular-nums text-on-surface-variant">
              <span>{min.toFixed(1)} bps</span>
              <span>0</span>
              <span>{max.toFixed(1)} bps</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Role distribution horizontal bars
function RoleDistribution({ rows }: { rows: readonly ScanRow[] }) {
  const counts = {
    primary: rows.filter((r) => r.role === "primary").length,
    secondary: rows.filter((r) => r.role === "secondary").length,
    retained: rows.filter((r) => r.role === "retained").length,
    none: rows.filter((r) => r.role === "none").length,
  };
  const total = rows.length;
  const items: { key: string; label: string; n: number; color: string }[] = [
    { key: "primary", label: "Primary", n: counts.primary, color: "bg-primary" },
    {
      key: "secondary",
      label: "Secondary",
      n: counts.secondary,
      color: "bg-[#4F9DF0]",
    },
    { key: "retained", label: "Retained", n: counts.retained, color: "bg-tertiary" },
    {
      key: "none",
      label: "None",
      n: counts.none,
      color: "bg-on-surface-variant/60",
    },
  ];
  return (
    <Card>
      <CardHeader>
        <span className="label-caps flex items-center gap-2">
          <Layers className="h-3.5 w-3.5" />
          Role Distribution
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 ? (
          <div className="flex h-32 items-center justify-center font-mono text-xs text-on-surface-variant">
            No rows yet.
          </div>
        ) : (
          items.map((it) => {
            const pct = total === 0 ? 0 : (it.n / total) * 100;
            return (
              <div key={it.key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="label-caps">{it.label}</span>
                  <span className="font-mono text-xs tabular-nums text-on-surface">
                    {it.n}{" "}
                    <span className="text-on-surface-variant">
                      ({pct.toFixed(1)}%)
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-sm bg-surface-low">
                  <div
                    className={cn("h-full", it.color)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// Top movers (evidence delta)
function TopMovers({
  snapshot,
  prevSnapshot,
}: {
  snapshot: ScanSnapshot | null;
  prevSnapshot: ScanSnapshot | null | undefined;
}) {
  const movers = useMemo(() => {
    if (!snapshot || !prevSnapshot) return null;
    const prev = new Map<string, ScanRow>();
    for (const r of prevSnapshot.rows) prev.set(r.symbol, r);
    const deltas: { symbol: string; dEvidence: number; dMu: number }[] = [];
    for (const r of snapshot.rows) {
      const p = prev.get(r.symbol);
      if (!p) continue;
      deltas.push({
        symbol: r.symbol,
        dEvidence: r.evidence - p.evidence,
        dMu: r.mu - p.mu,
      });
    }
    const climbers = [...deltas]
      .filter((d) => d.dEvidence > 0)
      .sort((a, b) => b.dEvidence - a.dEvidence)
      .slice(0, 5);
    const droppers = [...deltas]
      .filter((d) => d.dEvidence < 0)
      .sort((a, b) => a.dEvidence - b.dEvidence)
      .slice(0, 5);
    return { climbers, droppers };
  }, [snapshot, prevSnapshot]);

  return (
    <Card>
      <CardHeader>
        <span className="label-caps flex items-center gap-2">
          <Activity className="h-3.5 w-3.5" />
          Top Movers
        </span>
        <span className="label-caps">Δ Evidence</span>
      </CardHeader>
      <CardContent>
        {!movers ? (
          <div className="flex h-32 items-center justify-center font-mono text-xs text-on-surface-variant">
            Waiting for a second snapshot to compute deltas…
          </div>
        ) : movers.climbers.length === 0 && movers.droppers.length === 0 ? (
          <div className="flex h-32 items-center justify-center font-mono text-xs text-on-surface-variant">
            No symbol-level changes detected.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
                <span className="label-caps text-primary">Climbers</span>
              </div>
              {movers.climbers.length === 0 ? (
                <div className="font-mono text-xs text-on-surface-variant">—</div>
              ) : (
                movers.climbers.map((m) => (
                  <div
                    key={m.symbol}
                    className="flex items-center justify-between border-b border-border/40 py-1 last:border-0"
                  >
                    <span className="font-mono text-sm font-semibold text-on-surface">
                      {m.symbol}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-primary">
                      +{m.dEvidence.toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-3.5 w-3.5 text-error" />
                <span className="label-caps text-error">Droppers</span>
              </div>
              {movers.droppers.length === 0 ? (
                <div className="font-mono text-xs text-on-surface-variant">—</div>
              ) : (
                movers.droppers.map((m) => (
                  <div
                    key={m.symbol}
                    className="flex items-center justify-between border-b border-border/40 py-1 last:border-0"
                  >
                    <span className="font-mono text-sm font-semibold text-on-surface">
                      {m.symbol}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-error">
                      {m.dEvidence.toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Sidecar health
interface ApiStatusPayload {
  ok: boolean;
  horizon?: string;
  universe?: string;
  mock?: boolean;
}

type Health = "up" | "down" | "unknown";

function HealthRow({
  label,
  health,
  detail,
  Icon,
}: {
  label: string;
  health: Health;
  detail: string;
  Icon: typeof Database;
}) {
  const dot =
    health === "up"
      ? "bg-primary"
      : health === "down"
        ? "bg-error"
        : "bg-on-surface-variant";
  const pulse = health === "up";
  const text =
    health === "up" ? "UP" : health === "down" ? "DOWN" : "UNKNOWN";
  const textClass =
    health === "up"
      ? "text-primary"
      : health === "down"
        ? "text-error"
        : "text-on-surface-variant";
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-2 last:border-0">
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-on-surface-variant" />
        <div className="flex flex-col">
          <span className="font-mono text-sm font-semibold text-on-surface">
            {label}
          </span>
          <span className="font-mono text-[10px] text-on-surface-variant">
            {detail}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", dot, pulse && "led-pulse")} />
        <span className={cn("label-caps", textClass)}>{text}</span>
      </div>
    </div>
  );
}

function SidecarHealth({ snapshot }: { snapshot: ScanSnapshot | null }) {
  const [apiOk, setApiOk] = useState<Health>("unknown");
  const [apiDetail, setApiDetail] = useState<string>("never");

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiStatusPayload;
        if (cancelled) return;
        setApiOk(json.ok ? "up" : "down");
        setApiDetail(
          `universe=${json.universe ?? "—"} · mock=${json.mock ? "1" : "0"}`
        );
      } catch {
        if (cancelled) return;
        setApiOk("down");
        setApiDetail("status fetch failed");
      }
    };

    void tick();
    const t = setInterval(() => void tick(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const rows = snapshot?.rows ?? [];
  const xgbUp = rows.some((r) => r.mlScore !== null);
  const xgbCount = rows.filter((r) => r.mlScore !== null).length;
  const fundUp = rows.some((r) => r.quality !== 50);

  return (
    <Card>
      <CardHeader>
        <span className="label-caps flex items-center gap-2">
          <Radio className="h-3.5 w-3.5" />
          Sidecar Health
        </span>
      </CardHeader>
      <CardContent>
        <HealthRow
          label="Postgres / API"
          health={apiOk}
          detail={apiDetail}
          Icon={Database}
        />
        <HealthRow
          label="XGBoost"
          health={xgbUp ? "up" : rows.length === 0 ? "unknown" : "down"}
          detail={
            rows.length === 0
              ? "no rows yet"
              : `${xgbCount}/${rows.length} rows scored`
          }
          Icon={Activity}
        />
        <HealthRow
          label="Fundamentals"
          health={fundUp ? "up" : rows.length === 0 ? "unknown" : "down"}
          detail={
            rows.length === 0
              ? "no rows yet"
              : fundUp
                ? "quality signal present"
                : "quality fallback (=50)"
          }
          Icon={Coins}
        />
      </CardContent>
    </Card>
  );
}

// Silence unused-import lints for the colour maps; they're referenced via cn().
void DECISION_COLORS;
void DECISION_TEXT_COLORS;

// -- main --------------------------------------------------------------------

export function ExecutiveDashboard({
  snapshot,
  prevSnapshot,
  status,
  lastUpdate,
}: ExecutiveDashboardProps): React.JSX.Element {
  const rows = snapshot?.rows ?? [];

  return (
    <div className="space-y-6 px-6 pb-6">
      <PipelineStrip
        snapshot={snapshot}
        status={status}
        lastUpdate={lastUpdate}
      />

      <KpiRow rows={rows} />

      <DecisionDistribution rows={rows} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <NetHistogram rows={rows} />
        <RoleDistribution rows={rows} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopMovers snapshot={snapshot} prevSnapshot={prevSnapshot} />
        <SidecarHealth snapshot={snapshot} />
      </div>
    </div>
  );
}
