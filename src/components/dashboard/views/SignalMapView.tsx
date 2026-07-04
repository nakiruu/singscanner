"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { cn } from "@/lib/utils";
import type { Decision, ScanRow, ScanSnapshot } from "@/lib/engine/types";

export interface SignalMapViewProps {
  snapshot: ScanSnapshot | null;
  onSelectSymbol?: (symbol: string) => void;
}

type PopulationFilter = "buy" | "buy-wait" | "actionable" | "all";

interface Point {
  row: ScanRow;
  cx: number;   // svg coord
  cy: number;
  r: number;
}

interface HoverState {
  row: ScanRow;
  x: number;
  y: number;
}

const DECISION_FILL: Record<Decision, string> = {
  BUY: "#3ecf8e",
  WAIT: "#FFA072",
  "HOLD-CASH": "#4F9DF0",
  HOLD: "#4F9DF0",
  SELL: "#E2566B",
  ROTATE: "#A78BFA",
};

const MARGIN = { top: 24, right: 24, bottom: 48, left: 56 };

// Choose which rows to plot based on filter
function selectRows(rows: readonly ScanRow[], filter: PopulationFilter): ScanRow[] {
  switch (filter) {
    case "buy":         return rows.filter((r) => r.decision === "BUY");
    case "buy-wait":    return rows.filter((r) => r.decision === "BUY" || r.decision === "WAIT");
    case "actionable":  return rows.filter((r) => r.role !== "none");
    case "all":         return [...rows];
  }
}

// A dot's radius scales with confidence so users can spot high-conviction signals.
function dotRadius(row: ScanRow): number {
  return 3.5 + (row.confidence ?? 0) * 3.5; // 3.5-7 px
}

export function SignalMapView({ snapshot, onSelectSymbol }: SignalMapViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(960);
  const [height, setHeight] = useState(560);
  const [filter, setFilter] = useState<PopulationFilter>("buy");
  const [hovered, setHovered] = useState<HoverState | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setWidth(w);
      }
    });
    ro.observe(el);
    const mq = window.matchMedia("(min-width: 1024px)");
    const updateHeight = () => setHeight(mq.matches ? 640 : 500);
    updateHeight();
    mq.addEventListener("change", updateHeight);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", updateHeight);
    };
  }, []);

  const rows = snapshot?.rows ?? [];
  const selected = useMemo(() => selectRows(rows, filter), [rows, filter]);

  // Domains
  const { xMin, xMax, yMin, yMax, points, plotW, plotH } = useMemo(() => {
    const plotW = Math.max(0, width - MARGIN.left - MARGIN.right);
    const plotH = Math.max(0, height - MARGIN.top - MARGIN.bottom);

    if (selected.length === 0) {
      return { xMin: 0, xMax: 100, yMin: 0, yMax: 100, points: [], plotW, plotH };
    }

    let xMinRaw = Infinity;
    let xMaxRaw = -Infinity;
    for (const r of selected) {
      if (r.net < xMinRaw) xMinRaw = r.net;
      if (r.net > xMaxRaw) xMaxRaw = r.net;
    }
    // Pad the x-domain a little; force a small negative window so "bad" rows aren't cropped.
    const xPad = Math.max(20, (xMaxRaw - xMinRaw) * 0.05);
    const xMin = Math.min(xMinRaw - xPad, -20);
    const xMax = xMaxRaw + xPad;
    // Y is always the ML-score range.
    const yMin = 0;
    const yMax = 100;

    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    const points: Point[] = [];
    for (const row of selected) {
      // Rows without mlScore can't be placed on the Y-axis — skip them.
      if (row.mlScore == null || !Number.isFinite(row.mlScore)) continue;
      const cx = MARGIN.left + ((row.net - xMin) / xRange) * plotW;
      const cy = MARGIN.top + plotH - ((row.mlScore - yMin) / yRange) * plotH;
      points.push({ row, cx, cy, r: dotRadius(row) });
    }
    return { xMin, xMax, yMin, yMax, points, plotW, plotH };
  }, [selected, width, height]);

  // Origin (net = 0) x-position, if within domain
  const originX = useMemo(() => {
    if (xMin > 0 || xMax < 0) return null;
    return MARGIN.left + ((0 - xMin) / (xMax - xMin || 1)) * plotW;
  }, [xMin, xMax, plotW]);

  // ML midpoint (y=50)
  const midY = useMemo(
    () => MARGIN.top + plotH - ((50 - yMin) / (yMax - yMin || 1)) * plotH,
    [yMin, yMax, plotH],
  );

  // Axis ticks
  const xTicks = useMemo(() => niceTicks(xMin, xMax, 6), [xMin, xMax]);
  const yTicks = [0, 25, 50, 75, 100];

  const skippedNoMl = selected.length - points.length;

  if (!snapshot) {
    return (
      <div className="px-6 pb-6">
        <div className="rounded-lg border border-border bg-surface-lowest p-8 text-center">
          <p className="font-mono text-xs text-on-surface-variant">Awaiting first scan…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pb-6">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="label-caps">Signal Map</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            Top-right = strongest gate & ML combined
          </span>
        </div>
        <div className="flex items-center gap-4">
          <FilterToggle value={filter} onChange={setFilter} />
          <span className="font-mono text-xs text-on-surface-variant tabular-nums">
            {points.length.toString().padStart(3, "0")} plotted
            {skippedNoMl > 0 && (
              <span className="ml-1 text-terminal-gray">
                ({skippedNoMl} missing ML)
              </span>
            )}
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative rounded-lg border border-border bg-surface-lowest"
        style={{ height }}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Gate score vs ML score scatter plot"
        >
          {/* Grid lines */}
          {yTicks.map((t) => {
            const y = MARGIN.top + plotH - (t / 100) * plotH;
            return (
              <line
                key={`gy-${t}`}
                x1={MARGIN.left}
                x2={MARGIN.left + plotW}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.05)"
                strokeWidth={1}
              />
            );
          })}
          {xTicks.map((t) => {
            const x = MARGIN.left + ((t - xMin) / (xMax - xMin || 1)) * plotW;
            return (
              <line
                key={`gx-${t}`}
                x1={x}
                x2={x}
                y1={MARGIN.top}
                y2={MARGIN.top + plotH}
                stroke="rgba(255,255,255,0.05)"
                strokeWidth={1}
              />
            );
          })}

          {/* Zero-net (origin) line — the "gate wall" */}
          {originX !== null && (
            <>
              <line
                x1={originX}
                x2={originX}
                y1={MARGIN.top}
                y2={MARGIN.top + plotH}
                stroke="rgba(255,255,255,0.30)"
                strokeWidth={1.25}
                strokeDasharray="4 3"
              />
              <text
                x={originX + 4}
                y={MARGIN.top + 12}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fontSize={9}
                fill="rgba(255,255,255,0.45)"
                letterSpacing={1}
                style={{ textTransform: "uppercase" }}
              >
                gate wall
              </text>
            </>
          )}
          {/* ML midpoint line */}
          <line
            x1={MARGIN.left}
            x2={MARGIN.left + plotW}
            y1={midY}
            y2={midY}
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />

          {/* Quadrant labels — anchored to plot corners */}
          <QuadrantLabel
            x={MARGIN.left + plotW - 10}
            y={MARGIN.top + 20}
            anchor="end"
            text="STRONG GATE · HIGH ML"
            tone="emerald"
          />
          <QuadrantLabel
            x={MARGIN.left + 10}
            y={MARGIN.top + 20}
            anchor="start"
            text="WEAK GATE · HIGH ML"
            tone="dim"
          />
          <QuadrantLabel
            x={MARGIN.left + plotW - 10}
            y={MARGIN.top + plotH - 8}
            anchor="end"
            text="STRONG GATE · LOW ML"
            tone="dim"
          />
          <QuadrantLabel
            x={MARGIN.left + 10}
            y={MARGIN.top + plotH - 8}
            anchor="start"
            text="WEAK GATE · LOW ML"
            tone="error"
          />

          {/* Axes */}
          {/* Y axis */}
          <line
            x1={MARGIN.left}
            x2={MARGIN.left}
            y1={MARGIN.top}
            y2={MARGIN.top + plotH}
            stroke="rgba(255,255,255,0.20)"
          />
          {yTicks.map((t) => {
            const y = MARGIN.top + plotH - (t / 100) * plotH;
            return (
              <g key={`yt-${t}`}>
                <line
                  x1={MARGIN.left - 4}
                  x2={MARGIN.left}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.25)"
                />
                <text
                  x={MARGIN.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontSize={10}
                  fill="rgba(255,255,255,0.55)"
                >
                  {t}
                </text>
              </g>
            );
          })}
          <text
            x={MARGIN.left - 42}
            y={MARGIN.top + plotH / 2}
            transform={`rotate(-90, ${MARGIN.left - 42}, ${MARGIN.top + plotH / 2})`}
            textAnchor="middle"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize={10}
            letterSpacing={1.2}
            fill="rgba(255,255,255,0.5)"
            style={{ textTransform: "uppercase" }}
          >
            ML Score (%)
          </text>

          {/* X axis */}
          <line
            x1={MARGIN.left}
            x2={MARGIN.left + plotW}
            y1={MARGIN.top + plotH}
            y2={MARGIN.top + plotH}
            stroke="rgba(255,255,255,0.20)"
          />
          {xTicks.map((t) => {
            const x = MARGIN.left + ((t - xMin) / (xMax - xMin || 1)) * plotW;
            return (
              <g key={`xt-${t}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={MARGIN.top + plotH}
                  y2={MARGIN.top + plotH + 4}
                  stroke="rgba(255,255,255,0.25)"
                />
                <text
                  x={x}
                  y={MARGIN.top + plotH + 16}
                  textAnchor="middle"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontSize={10}
                  fill="rgba(255,255,255,0.55)"
                >
                  {formatBps(t)}
                </text>
              </g>
            );
          })}
          <text
            x={MARGIN.left + plotW / 2}
            y={height - 8}
            textAnchor="middle"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize={10}
            letterSpacing={1.2}
            fill="rgba(255,255,255,0.5)"
            style={{ textTransform: "uppercase" }}
          >
            Gate Net Surplus (bps)
          </text>

          {/* Points — draw non-hovered first, hovered on top */}
          {points.map((p) => {
            const isHovered = hovered?.row.symbol === p.row.symbol;
            if (isHovered) return null;
            const fill = DECISION_FILL[p.row.decision];
            return (
              <circle
                key={p.row.symbol}
                cx={p.cx}
                cy={p.cy}
                r={p.r}
                fill={fill}
                fillOpacity={0.75}
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={0.75}
                onMouseMove={(ev) =>
                  setHovered({
                    row: p.row,
                    x: ev.nativeEvent.offsetX,
                    y: ev.nativeEvent.offsetY,
                  })
                }
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelectSymbol?.(p.row.symbol)}
                style={{ cursor: "pointer" }}
              />
            );
          })}
          {hovered &&
            (() => {
              const p = points.find((x) => x.row.symbol === hovered.row.symbol);
              if (!p) return null;
              const fill = DECISION_FILL[p.row.decision];
              return (
                <circle
                  key={`hovered-${p.row.symbol}`}
                  cx={p.cx}
                  cy={p.cy}
                  r={p.r + 2}
                  fill={fill}
                  fillOpacity={1}
                  stroke="rgba(255,255,255,0.9)"
                  strokeWidth={1.5}
                  onMouseMove={(ev) =>
                    setHovered({
                      row: p.row,
                      x: ev.nativeEvent.offsetX,
                      y: ev.nativeEvent.offsetY,
                    })
                  }
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onSelectSymbol?.(p.row.symbol)}
                  style={{ cursor: "pointer" }}
                />
              );
            })()}
        </svg>

        {hovered && <ScatterTooltip state={hovered} containerWidth={width} containerHeight={height} />}

        {points.length === 0 && rows.length > 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="font-mono text-xs text-on-surface-variant">
              No symbols match the current filter.
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-2 flex h-7 items-center gap-3 px-1">
        {(["BUY", "WAIT", "HOLD-CASH", "HOLD"] as Decision[]).map((d) => (
          <div key={d} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: DECISION_FILL[d] }}
              aria-hidden="true"
            />
            <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              {d}
            </span>
          </div>
        ))}
        <span className="ml-4 font-mono text-[10px] uppercase tracking-wider text-terminal-gray">
          Dot size = confidence
        </span>
      </div>
    </div>
  );
}

// ---- helpers -------------------------------------------------------------

function formatBps(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(0);
}

// "Nice" axis ticks based on rough magnitude.
function niceTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const range = max - min;
  const rawStep = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const stepMult = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  const step = stepMult * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) {
    // Guard against float drift creating stray ticks past max
    if (v <= max + step * 0.5) ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

interface QuadrantLabelProps {
  x: number;
  y: number;
  anchor: "start" | "end";
  text: string;
  tone: "emerald" | "error" | "dim";
}

function QuadrantLabel({ x, y, anchor, text, tone }: QuadrantLabelProps): JSX.Element {
  const fill =
    tone === "emerald"
      ? "rgba(62,207,142,0.55)"
      : tone === "error"
        ? "rgba(226,86,107,0.45)"
        : "rgba(255,255,255,0.25)";
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      fontSize={9}
      letterSpacing={1.2}
      fill={fill}
      pointerEvents="none"
      style={{ textTransform: "uppercase" }}
    >
      {text}
    </text>
  );
}

function FilterToggle({
  value,
  onChange,
}: {
  value: PopulationFilter;
  onChange: (next: PopulationFilter) => void;
}): JSX.Element {
  const opts: ReadonlyArray<{ id: PopulationFilter; label: string }> = [
    { id: "buy",        label: "BUY only" },
    { id: "buy-wait",   label: "BUY + WAIT" },
    { id: "actionable", label: "Actionable" },
    { id: "all",        label: "All" },
  ];
  return (
    <div className="flex items-center gap-2">
      <span className="label-caps">Show:</span>
      <div className="flex items-center rounded-md border border-border bg-surface-low/40 p-0.5">
        {opts.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cn(
              "px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition",
              value === opt.id
                ? "rounded bg-surface-lowest text-on-surface"
                : "text-on-surface-variant hover:text-on-surface",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ScatterTooltip({
  state,
  containerWidth,
  containerHeight,
}: {
  state: HoverState;
  containerWidth: number;
  containerHeight: number;
}): JSX.Element {
  const { row, x, y } = state;
  const tipW = 200;
  const tipH = 120;
  const left = Math.min(Math.max(0, x + 12), Math.max(0, containerWidth - tipW - 4));
  const top = Math.min(Math.max(0, y + 12), Math.max(0, containerHeight - tipH - 4));
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface-low/95 p-3 shadow-lg backdrop-blur"
      style={{ left, top, width: tipW }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-bold text-on-surface">{row.symbol}</span>
        <span
          className={cn(
            "font-mono text-[10px] tracking-wider",
            row.decision === "BUY" && "text-primary",
            row.decision === "WAIT" && "text-tertiary",
            row.decision === "SELL" && "text-error",
            (row.decision === "HOLD" || row.decision === "HOLD-CASH") && "text-[#4F9DF0]",
          )}
        >
          {row.decision}
        </span>
      </div>
      <dl className="mt-2 space-y-1 font-mono text-xs">
        <TooltipRow label="net" value={`${row.net >= 0 ? "+" : ""}${row.net.toFixed(1)} bps`} />
        <TooltipRow label="ML" value={row.mlScore != null ? `${Math.round(row.mlScore)}%` : "—"} />
        <TooltipRow label="μ" value={`${row.mu >= 0 ? "+" : ""}${row.mu.toFixed(1)} bps`} />
        <TooltipRow label="conf" value={`${Math.round(row.confidence * 100)}%`} />
      </dl>
    </div>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="tabular-nums text-on-surface">{value}</dd>
    </div>
  );
}
