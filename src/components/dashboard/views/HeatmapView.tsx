"use client";

import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from "d3-hierarchy";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { Decision, Role, ScanRow, ScanSnapshot } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

export interface HeatmapViewProps {
  snapshot: ScanSnapshot | null;
  onSelectSymbol?: (symbol: string) => void;
}

type ColorBy = "decision" | "net" | "mu";
type GroupBy = "none" | "exchange" | "decision" | "role";

const DECISION_COLOR: Record<Decision, string> = {
  BUY: "#3ecf8e",
  WAIT: "#FFA072",
  HOLD: "#4F9DF0",
  "HOLD-CASH": "#4F9DF0",
  SELL: "#E2566B",
  ROTATE: "#A78BFA",
};

const DECISION_ORDER: readonly Decision[] = ["BUY", "WAIT", "HOLD-CASH", "HOLD", "SELL"];
const ROLE_ORDER: readonly Role[] = ["primary", "secondary", "retained", "none"];

const MAX_TILES = 200;

function sizeProxy(row: ScanRow): number {
  // Notional per-share x activity proxy: price * relVol.
  const rv = row.relVol > 0 ? row.relVol : 1;
  return Math.max(1, row.price * rv);
}

// Smooth red->neutral->green ramp through HSL for net/mu modes.
function rampColor(value: number, scale: number): string {
  const clamped = Math.max(-1, Math.min(1, value / scale));
  // Hue: 0 (red) at -1, 50 (yellow) at 0, 145 (emerald) at +1.
  const hue = clamped < 0 ? 0 + (1 + clamped) * 50 : 50 + clamped * 95;
  const sat = 55 + Math.abs(clamped) * 25;
  const light = 42 + (1 - Math.abs(clamped)) * 6;
  return `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

function fillFor(row: ScanRow, mode: ColorBy): string {
  if (mode === "decision") return DECISION_COLOR[row.decision] ?? "#4F9DF0";
  if (mode === "net") return rampColor(row.net, 25); // ±25 bps spans full range
  return rampColor(row.mu, 25);
}

function brighten(hex: string): string {
  // Works for hsl(...) and #rrggbb. For HSL, bump lightness; for hex, overlay rgba white via filter-like mix.
  if (hex.startsWith("hsl(")) {
    return hex.replace(/(\d+)%\)$/, (_m, l: string) => {
      const next = Math.min(72, Number(l) + 10);
      return `${next}%)`;
    });
  }
  // hex → mix with white 18%.
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.18));
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

interface Leaf {
  row: ScanRow;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface GroupBox {
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TooltipState {
  row: ScanRow;
  x: number;
  y: number;
}

function selectRows(rows: ScanRow[]): ScanRow[] {
  if (rows.length <= MAX_TILES) return rows;
  // Always include all BUY / WAIT; fill remainder with biggest by size proxy.
  const priority: ReadonlySet<Decision> = new Set<Decision>(["BUY", "WAIT"]);
  const must = rows.filter((r) => priority.has(r.decision));
  const rest = rows.filter((r) => !priority.has(r.decision));
  rest.sort((a, b) => sizeProxy(b) - sizeProxy(a));
  const remaining = Math.max(0, MAX_TILES - must.length);
  const tail = rest.slice(0, remaining);
  // If must alone overflows MAX_TILES, keep them all anyway — caller asked.
  const combined = [...must, ...tail];
  // De-dupe by symbol just in case.
  const seen = new Set<string>();
  return combined.filter((r) => (seen.has(r.symbol) ? false : (seen.add(r.symbol), true)));
}

function groupKeyFor(row: ScanRow, mode: GroupBy): string {
  if (mode === "exchange") {
    const ex = row.exchange?.toUpperCase() ?? "";
    if (ex === "NYSE") return "NYSE";
    if (ex === "NASDAQ") return "NASDAQ";
    return "OTHER";
  }
  if (mode === "decision") return row.decision;
  if (mode === "role") return row.role;
  return "";
}

function groupOrderFor(mode: GroupBy): readonly string[] {
  if (mode === "exchange") return ["NYSE", "NASDAQ", "OTHER"];
  if (mode === "decision") return DECISION_ORDER;
  if (mode === "role") return ROLE_ORDER;
  return [];
}

// Discriminated hierarchy nodes: root wraps groups OR leaves; group wraps leaves; leaf wraps a row.
type HierNode =
  | { kind: "root"; children: HierNode[] }
  | { kind: "group"; name: string; children: HierNode[] }
  | { kind: "leaf"; row: ScanRow };

export function HeatmapView({ snapshot, onSelectSymbol }: HeatmapViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(960);
  const [height, setHeight] = useState<number>(520);
  const [colorBy, setColorBy] = useState<ColorBy>("decision");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [zoomedGroup, setZoomedGroup] = useState<string | null>(null);
  const [hovered, setHovered] = useState<TooltipState | null>(null);

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
    // Tailwind lg breakpoint is 1024px.
    const mq = window.matchMedia("(min-width: 1024px)");
    const updateHeight = () => setHeight(mq.matches ? 720 : 520);
    updateHeight();
    mq.addEventListener("change", updateHeight);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", updateHeight);
    };
  }, []);

  // Reset zoom when grouping changes.
  useEffect(() => {
    setZoomedGroup(null);
  }, [groupBy]);

  const rows = snapshot?.rows ?? [];

  // Filter rows to the zoomed group first (if any), then apply top-N cap.
  const filteredRows = useMemo<ScanRow[]>(() => {
    if (groupBy === "none" || zoomedGroup === null) return rows;
    return rows.filter((r) => groupKeyFor(r, groupBy) === zoomedGroup);
  }, [rows, groupBy, zoomedGroup]);

  const selected = useMemo(() => selectRows(filteredRows), [filteredRows]);

  // When zoomed OR groupBy is none, we render flat. Otherwise we render nested with group boxes.
  const isNested = groupBy !== "none" && zoomedGroup === null;

  const { leaves, groups } = useMemo<{ leaves: Leaf[]; groups: GroupBox[] }>(() => {
    if (selected.length === 0 || width <= 0 || height <= 0) return { leaves: [], groups: [] };

    if (!isNested) {
      // Flat hierarchy (existing behavior, or zoomed-in single group).
      const root: HierNode = {
        kind: "root",
        children: selected.map<HierNode>((row) => ({ kind: "leaf", row })),
      };
      const h = hierarchy<HierNode>(root, (d) => (d.kind === "leaf" ? null : d.children)).sum((d) =>
        d.kind === "leaf" ? sizeProxy(d.row) : 0
      );
      treemap<HierNode>()
        .tile(treemapSquarify)
        .size([width, height])
        .padding(2)
        .round(true)(h);

      const outLeaves: Leaf[] = [];
      for (const node of h.leaves() as Array<HierarchyRectangularNode<HierNode>>) {
        if (node.data.kind !== "leaf") continue;
        outLeaves.push({ row: node.data.row, x0: node.x0, y0: node.y0, x1: node.x1, y1: node.y1 });
      }
      return { leaves: outLeaves, groups: [] };
    }

    // Nested: build 2-level hierarchy by group.
    const buckets = new Map<string, ScanRow[]>();
    for (const r of selected) {
      const k = groupKeyFor(r, groupBy);
      const arr = buckets.get(k);
      if (arr) arr.push(r);
      else buckets.set(k, [r]);
    }
    const order = groupOrderFor(groupBy);
    const orderedNames: string[] = [
      ...order.filter((n) => buckets.has(n)),
      ...[...buckets.keys()].filter((n) => !order.includes(n)),
    ];
    const root: HierNode = {
      kind: "root",
      children: orderedNames.map<HierNode>((name) => ({
        kind: "group",
        name,
        children: (buckets.get(name) ?? []).map<HierNode>((row) => ({ kind: "leaf", row })),
      })),
    };
    const h = hierarchy<HierNode>(root, (d) => (d.kind === "leaf" ? null : d.children)).sum((d) =>
      d.kind === "leaf" ? sizeProxy(d.row) : 0
    );
    treemap<HierNode>()
      .tile(treemapSquarify)
      .size([width, height])
      .round(true)
      .paddingOuter(6)
      .paddingTop(20)
      .paddingInner(1)(h);

    const outLeaves: Leaf[] = [];
    const outGroups: GroupBox[] = [];
    for (const node of h.descendants() as Array<HierarchyRectangularNode<HierNode>>) {
      const d = node.data;
      if (d.kind === "group") {
        outGroups.push({ name: d.name, x0: node.x0, y0: node.y0, x1: node.x1, y1: node.y1 });
      } else if (d.kind === "leaf") {
        outLeaves.push({ row: d.row, x0: node.x0, y0: node.y0, x1: node.x1, y1: node.y1 });
      }
    }
    return { leaves: outLeaves, groups: outGroups };
  }, [selected, width, height, isNested, groupBy]);

  const count = rows.length;

  // Decision counts for legend chips (based on full rows, not the top-N cap).
  const decisionCounts = useMemo<Record<Decision, number>>(() => {
    const c: Record<Decision, number> = { BUY: 0, WAIT: 0, "HOLD-CASH": 0, HOLD: 0, SELL: 0, ROTATE: 0 };
    for (const r of rows) c[r.decision] = (c[r.decision] ?? 0) + 1;
    return c;
  }, [rows]);

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
        <span className="label-caps">Market Heatmap</span>
        <div className="flex items-center gap-4">
          <GroupToggle value={groupBy} onChange={setGroupBy} />
          <ColorToggle value={colorBy} onChange={setColorBy} />
          <span className="font-mono text-xs text-on-surface-variant tabular-nums">
            {count.toString().padStart(3, "0")}
          </span>
        </div>
      </div>

      {groupBy !== "none" && (
        <Breadcrumb
          zoomedGroup={zoomedGroup}
          onReset={() => setZoomedGroup(null)}
        />
      )}

      <div
        ref={containerRef}
        className="relative rounded-lg border border-border bg-surface-lowest"
        style={{ height }}
      >
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="font-mono text-xs text-on-surface-variant">
              No symbols passed the universe filter.
            </p>
          </div>
        ) : (
          <>
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label="Market heatmap treemap"
            >
              {groups.map((g) => (
                <GroupBoundary
                  key={`grp-${g.name}`}
                  group={g}
                  onZoom={() => setZoomedGroup(g.name)}
                />
              ))}
              {leaves.map((leaf) => (
                <HeatmapTile
                  key={leaf.row.symbol}
                  leaf={leaf}
                  colorBy={colorBy}
                  isHovered={hovered?.row.symbol === leaf.row.symbol}
                  onHover={(ev) =>
                    setHovered({
                      row: leaf.row,
                      x: ev.nativeEvent.offsetX,
                      y: ev.nativeEvent.offsetY,
                    })
                  }
                  onLeave={() => setHovered(null)}
                  onClick={() => onSelectSymbol?.(leaf.row.symbol)}
                />
              ))}
            </svg>
            {hovered && <HeatmapTooltip state={hovered} containerWidth={width} containerHeight={height} />}
          </>
        )}
      </div>

      <Legend colorBy={colorBy} decisionCounts={decisionCounts} />
    </div>
  );
}

interface HeatmapTileProps {
  leaf: Leaf;
  colorBy: ColorBy;
  isHovered: boolean;
  onHover: (ev: React.MouseEvent<SVGGElement>) => void;
  onLeave: () => void;
  onClick: () => void;
}

function HeatmapTile({ leaf, colorBy, isHovered, onHover, onLeave, onClick }: HeatmapTileProps): JSX.Element {
  const { row, x0, y0, x1, y1 } = leaf;
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const baseFill = fillFor(row, colorBy);
  const fill = isHovered ? brighten(baseFill) : baseFill;
  const showLabels = w > 40 && h > 24;
  const showDecision = w > 80 && h > 40;

  const muStr = `${row.mu >= 0 ? "+" : ""}${row.mu.toFixed(1)}`;

  return (
    <g
      onMouseMove={onHover}
      onMouseLeave={onLeave}
      onClick={onClick}
      style={{ cursor: "pointer" }}
    >
      <rect
        x={x0}
        y={y0}
        width={w}
        height={h}
        fill={fill}
        stroke={isHovered ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.25)"}
        strokeWidth={isHovered ? 1.5 : 1}
      />
      {showLabels && (
        <>
          <text
            x={x0 + 6}
            y={y0 + 14}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize={11}
            fontWeight={700}
            fill="rgba(15,17,21,0.92)"
          >
            {row.symbol}
          </text>
          <text
            x={x1 - 6}
            y={y1 - 6}
            textAnchor="end"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize={10}
            fill="rgba(15,17,21,0.78)"
          >
            {muStr}
          </text>
          {showDecision && (
            <text
              x={x0 + 6}
              y={y0 + 28}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize={9}
              letterSpacing={1}
              fill="rgba(15,17,21,0.72)"
            >
              {row.decision}
            </text>
          )}
        </>
      )}
    </g>
  );
}

interface GroupBoundaryProps {
  group: GroupBox;
  onZoom: () => void;
}

// Rendered BEFORE leaves so leaves paint on top and receive clicks.
// The border rect is pointer-events:none. Only the label + the top strip react to clicks.
function GroupBoundary({ group, onZoom }: GroupBoundaryProps): JSX.Element {
  const { name, x0, y0, x1, y1 } = group;
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const showLabel = w > 60 && h > 24;
  // Top-strip zone (~18px) is where the label lives and where clicks zoom.
  const stripH = Math.min(18, h);
  return (
    <g>
      <rect
        x={x0}
        y={y0}
        width={w}
        height={h}
        fill="none"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={1}
        pointerEvents="none"
      />
      <rect
        x={x0}
        y={y0}
        width={w}
        height={stripH}
        fill="transparent"
        onClick={onZoom}
        style={{ cursor: "zoom-in" }}
      />
      {showLabel && (
        <text
          x={x0 + 12}
          y={y0 + 13}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize={10}
          letterSpacing={1.2}
          fill="rgba(255,255,255,0.72)"
          pointerEvents="none"
          style={{ textTransform: "uppercase" }}
        >
          {name}
        </text>
      )}
    </g>
  );
}

function HeatmapTooltip({
  state,
  containerWidth,
  containerHeight,
}: {
  state: TooltipState;
  containerWidth: number;
  containerHeight: number;
}): JSX.Element {
  const { row, x, y } = state;
  // Keep tooltip inside the container.
  const tipW = 180;
  const tipH = 110;
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
            row.decision === "SELL" && "text-error",
            row.decision === "WAIT" && "text-tertiary"
          )}
        >
          {row.decision}
        </span>
      </div>
      <dl className="mt-2 space-y-1 font-mono text-xs">
        <Row label="μ" value={`${row.mu >= 0 ? "+" : ""}${row.mu.toFixed(1)} bps`} />
        <Row label="net" value={`${row.net >= 0 ? "+" : ""}${row.net.toFixed(1)} bps`} />
        <Row label="conf" value={`${Math.round(row.confidence * 100)}%`} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="tabular-nums text-on-surface">{value}</dd>
    </div>
  );
}

function ColorToggle({
  value,
  onChange,
}: {
  value: ColorBy;
  onChange: (next: ColorBy) => void;
}): JSX.Element {
  const opts: ReadonlyArray<{ id: ColorBy; label: string }> = [
    { id: "decision", label: "decision" },
    { id: "net", label: "net" },
    { id: "mu", label: "μ" },
  ];
  return (
    <div className="flex items-center gap-2">
      <span className="label-caps">Color by:</span>
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
                : "text-on-surface-variant hover:text-on-surface"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function GroupToggle({
  value,
  onChange,
}: {
  value: GroupBy;
  onChange: (next: GroupBy) => void;
}): JSX.Element {
  const opts: ReadonlyArray<{ id: GroupBy; label: string }> = [
    { id: "none", label: "none" },
    { id: "exchange", label: "exchange" },
    { id: "decision", label: "decision" },
    { id: "role", label: "role" },
  ];
  return (
    <div className="flex items-center gap-2">
      <span className="label-caps">Group by:</span>
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
                : "text-on-surface-variant hover:text-on-surface"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Breadcrumb({
  zoomedGroup,
  onReset,
}: {
  zoomedGroup: string | null;
  onReset: () => void;
}): JSX.Element {
  return (
    <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
      <span className={cn(zoomedGroup === null && "text-on-surface")}>All</span>
      {zoomedGroup !== null && (
        <>
          <span className="text-on-surface-variant/60">›</span>
          <span className="text-on-surface">{zoomedGroup}</span>
          <button
            type="button"
            onClick={onReset}
            aria-label="Reset zoom"
            className="ml-1 flex h-4 w-4 items-center justify-center rounded border border-border text-on-surface-variant transition hover:text-on-surface"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
              <path d="M1 1 L7 7 M7 1 L1 7" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

function Legend({
  colorBy,
  decisionCounts,
}: {
  colorBy: ColorBy;
  decisionCounts: Record<Decision, number>;
}): JSX.Element {
  if (colorBy === "decision") {
    return (
      <div className="mt-2 flex h-7 items-center gap-3 px-1">
        {DECISION_ORDER.map((d) => (
          <div key={d} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: DECISION_COLOR[d] }}
              aria-hidden="true"
            />
            <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              {d} · {decisionCounts[d] ?? 0}
            </span>
          </div>
        ))}
      </div>
    );
  }
  // net / mu — gradient bar
  return (
    <div className="mt-2 flex h-7 items-center gap-2 px-1">
      <span className="font-mono text-[10px] tabular-nums text-on-surface-variant">-25 bps</span>
      <div
        className="h-3 flex-1 rounded-sm"
        style={{
          background:
            "linear-gradient(to right, hsl(0 80% 45%), hsl(50 55% 48%), hsl(145 80% 45%))",
        }}
        aria-hidden="true"
      />
      <span className="font-mono text-[10px] tabular-nums text-on-surface-variant">0</span>
      <div
        className="h-3 flex-1 rounded-sm"
        style={{
          background:
            "linear-gradient(to right, hsl(50 55% 48%), hsl(145 80% 45%))",
        }}
        aria-hidden="true"
      />
      <span className="font-mono text-[10px] tabular-nums text-on-surface-variant">+25 bps</span>
    </div>
  );
}
