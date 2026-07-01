"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DecisionBadge } from "@/components/dashboard/DecisionBadge";
import { ExchangeChip } from "@/components/dashboard/ExchangeChip";
import { GateBar } from "@/components/dashboard/GateBar";
import { MQLRBars } from "@/components/dashboard/MQLRBars";
import { StarButton } from "@/components/dashboard/StarButton";
import { exchangeFor } from "@/lib/ui-helpers";
import { useWatchlist } from "@/lib/hooks/useWatchlist";
import { cn } from "@/lib/utils";
import type { Decision, Role, ScanRow, ScanSnapshot } from "@/lib/engine/types";

export interface LiveTerminalProps {
  snapshot: ScanSnapshot | null;
  onSelectRow?: (row: ScanRow) => void;
}

// ---- column model ---------------------------------------------------------

type SortKey =
  | "rank"
  | "symbol"
  | "price"
  | "spreadBps"
  | "relVol"
  | "confidence"
  | "mu"
  | "evidence"
  | "mlScore"
  | "net"
  | "decision";

interface ColumnDef {
  id: SortKey | "mqlr" | "role" | "gate" | "actions";
  label: string;
  width: string;       // CSS grid track value
  align: "left" | "right" | "center";
  sortKey?: SortKey;   // omitted = unsortable
}

const COLUMNS: ColumnDef[] = [
  { id: "rank",       label: "#",            width: "40px",  align: "left",   sortKey: "rank" },
  { id: "symbol",     label: "Symbol",       width: "115px", align: "left",   sortKey: "symbol" },
  { id: "price",      label: "Price",        width: "80px",  align: "right",  sortKey: "price" },
  { id: "spreadBps",  label: "Spread",       width: "75px",  align: "right",  sortKey: "spreadBps" },
  { id: "relVol",     label: "Rel Vol",      width: "70px",  align: "right",  sortKey: "relVol" },
  { id: "mqlr",       label: "M·Q·L·R",      width: "100px", align: "center" },
  { id: "confidence", label: "Conf",         width: "60px",  align: "right",  sortKey: "confidence" },
  { id: "mu",         label: "μ bps",        width: "75px",  align: "right",  sortKey: "mu" },
  { id: "role",       label: "Role",         width: "90px",  align: "left" },
  { id: "evidence",   label: "Evid",         width: "60px",  align: "right",  sortKey: "evidence" },
  { id: "mlScore",    label: "ML",           width: "60px",  align: "right",  sortKey: "mlScore" },
  { id: "gate",       label: "Gate / Net",   width: "200px", align: "left",   sortKey: "net" },
  { id: "decision",   label: "Decision",     width: "100px", align: "left",   sortKey: "decision" },
  { id: "actions",    label: "",             width: "80px",  align: "right" },
];

const GRID_TEMPLATE = COLUMNS.map((c) => c.width).join(" ");

// ---- filter / sort state ---------------------------------------------------

const DECISIONS: Decision[] = ["BUY", "WAIT", "HOLD-CASH", "HOLD", "SELL"];
const ROLES: Array<Role | "any"> = ["any", "primary", "secondary", "retained", "none"];
type ExchangeFilter = "any" | "NYSE" | "NASDAQ";

interface SortState {
  key: SortKey | null;
  dir: "asc" | "desc";
}

function compareRows(a: ScanRow, b: ScanRow, sort: SortState): number {
  if (sort.key === null) return 0;
  const dir = sort.dir === "asc" ? 1 : -1;
  switch (sort.key) {
    case "symbol":    return a.symbol.localeCompare(b.symbol) * dir;
    case "decision":  return a.decision.localeCompare(b.decision) * dir;
    case "rank":      return 0; // rank reflects current row order; "asc/desc" toggles rank semantics done by the user reversing manually
    case "spreadBps": return (a.spreadBps - b.spreadBps) * dir;
    case "relVol":    return (a.relVol - b.relVol) * dir;
    case "confidence":return (a.confidence - b.confidence) * dir;
    case "mu":        return (a.mu - b.mu) * dir;
    case "evidence":  return (a.evidence - b.evidence) * dir;
    case "mlScore": {
      const av = a.mlScore ?? -Infinity;
      const bv = b.mlScore ?? -Infinity;
      return (av - bv) * dir;
    }
    case "net":       return (a.net - b.net) * dir;
    case "price":     return (a.price - b.price) * dir;
  }
}

function muTone(mu: number): string {
  if (mu > 0.1) return "text-primary";
  if (mu < -0.1) return "text-error";
  return "text-tertiary";
}

function RoleBadge({ role }: { role: Role }) {
  if (role === "primary") {
    return (
      <span className="inline-flex rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
        PRIMARY
      </span>
    );
  }
  if (role === "retained") {
    return (
      <span className="inline-flex rounded-sm border border-[#4F9DF0]/40 bg-[#4F9DF0]/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#4F9DF0]">
        RETAINED
      </span>
    );
  }
  if (role === "secondary") {
    return <Badge tone="neutral">SECONDARY</Badge>;
  }
  return <Badge tone="neutral">—</Badge>;
}

// ---- toolbar pieces -------------------------------------------------------

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-sm border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider transition",
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border bg-surface-low/60 text-on-surface-variant hover:border-primary/30 hover:text-on-surface",
      )}
    >
      {label}
    </button>
  );
}

// ---- main component -------------------------------------------------------

export function LiveTerminal({ snapshot, onSelectRow }: LiveTerminalProps) {
  const rows = snapshot?.rows ?? [];

  // Filter state
  const [search, setSearch] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<Set<Decision>>(new Set());
  const [roleFilter, setRoleFilter] = useState<Role | "any">("any");
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>("any");
  const [minEvidence, setMinEvidence] = useState(0);
  const [watchlistOnly, setWatchlistOnly] = useState(false);

  const [sort, setSort] = useState<SortState>({ key: null, dir: "desc" });

  const watchlist = useWatchlist();

  const filtered = useMemo(() => {
    const needle = search.trim().toUpperCase();
    return rows.filter((r) => {
      if (needle && !r.symbol.startsWith(needle)) return false;
      if (decisionFilter.size > 0 && !decisionFilter.has(r.decision)) return false;
      if (roleFilter !== "any" && r.role !== roleFilter) return false;
      if (exchangeFilter !== "any") {
        const ex = r.exchange ?? exchangeFor(r.symbol);
        if (ex !== exchangeFilter) return false;
      }
      if (r.evidence < minEvidence) return false;
      if (watchlistOnly && !watchlist.symbolSet.has(r.symbol)) return false;
      return true;
    });
  }, [
    rows,
    search,
    decisionFilter,
    roleFilter,
    exchangeFilter,
    minEvidence,
    watchlistOnly,
    watchlist.symbolSet,
  ]);

  const sorted = useMemo(() => {
    if (sort.key === null) return filtered;
    return [...filtered].sort((a, b) => compareRows(a, b, sort));
  }, [filtered, sort]);

  // Virtualization
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });

  const toggleDecision = (d: Decision) => {
    setDecisionFilter((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  const cycleSort = (col: ColumnDef) => {
    if (!col.sortKey) return;
    const key = col.sortKey;
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "desc" };
      if (prev.dir === "desc") return { key, dir: "asc" };
      return { key: null, dir: "desc" };
    });
  };

  const clearFilters = () => {
    setSearch("");
    setDecisionFilter(new Set());
    setRoleFilter("any");
    setExchangeFilter("any");
    setMinEvidence(0);
    setWatchlistOnly(false);
    setSort({ key: null, dir: "desc" });
  };

  const hasActiveFilters =
    !!search ||
    decisionFilter.size > 0 ||
    roleFilter !== "any" ||
    exchangeFilter !== "any" ||
    minEvidence > 0 ||
    watchlistOnly ||
    sort.key !== null;

  return (
    <div className="flex h-[calc(100vh-140px)] flex-col px-6 pb-4">
      {/* Toolbar */}
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <label className="relative flex-1 min-w-[200px] max-w-[280px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-terminal-gray" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search symbol…"
              className="h-8 w-full rounded-sm border border-border bg-surface-lowest pl-8 pr-3 font-mono text-xs text-on-surface placeholder:text-terminal-gray focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </label>

          {/* Decision chips */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="label-caps mr-1">Decision</span>
            {DECISIONS.map((d) => (
              <FilterChip
                key={d}
                label={d}
                active={decisionFilter.has(d)}
                onClick={() => toggleDecision(d)}
              />
            ))}
          </div>

          {/* Watchlist toggle */}
          <FilterChip
            label="★ Watchlist"
            active={watchlistOnly}
            onClick={() => setWatchlistOnly((v) => !v)}
          />

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant hover:border-error/40 hover:text-error"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Role */}
          <div className="flex items-center gap-1">
            <span className="label-caps mr-1">Role</span>
            {ROLES.map((r) => (
              <FilterChip
                key={r}
                label={r === "any" ? "Any" : r}
                active={roleFilter === r}
                onClick={() => setRoleFilter(r)}
              />
            ))}
          </div>

          {/* Exchange */}
          <div className="flex items-center gap-1">
            <span className="label-caps mr-1">Exch</span>
            {(["any", "NYSE", "NASDAQ"] as ExchangeFilter[]).map((ex) => (
              <FilterChip
                key={ex}
                label={ex === "any" ? "Any" : ex}
                active={exchangeFilter === ex}
                onClick={() => setExchangeFilter(ex)}
              />
            ))}
          </div>

          {/* Min Evidence */}
          <label className="flex items-center gap-2">
            <span className="label-caps">Min Evid</span>
            <input
              type="range"
              min={0}
              max={150}
              step={5}
              value={minEvidence}
              onChange={(e) => setMinEvidence(Number(e.target.value))}
              className="h-1 w-32 cursor-pointer accent-primary"
            />
            <span className="w-8 font-mono text-xs tabular-nums text-on-surface">
              {minEvidence}
            </span>
          </label>

          <span className="ml-auto font-mono text-xs text-terminal-gray">
            {sorted.length.toLocaleString()} / {rows.length.toLocaleString()} symbols
          </span>
        </div>
      </div>

      {/* Sticky header + virtualized body */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface-lowest/40">
        {/* Header */}
        <div
          className="grid border-b border-border bg-surface-low/60"
          style={{ gridTemplateColumns: GRID_TEMPLATE }}
        >
          {COLUMNS.map((c) => {
            const isSorted = sort.key === c.sortKey;
            const sortable = !!c.sortKey;
            return (
              <button
                key={c.id}
                type="button"
                disabled={!sortable}
                onClick={() => cycleSort(c)}
                className={cn(
                  "label-caps flex items-center gap-1 whitespace-nowrap px-3 py-2",
                  c.align === "right" && "justify-end",
                  c.align === "center" && "justify-center",
                  sortable && "cursor-pointer hover:text-on-surface",
                  isSorted && "text-primary",
                )}
              >
                <span>{c.label}</span>
                {sortable && (
                  isSorted ? (
                    sort.dir === "desc" ? (
                      <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUp className="h-3 w-3" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-30" />
                  )
                )}
              </button>
            );
          })}
        </div>

        {/* Virtualized rows */}
        <div ref={scrollRef} className="flex-1 overflow-auto">
          {sorted.length === 0 ? (
            <div className="flex h-full items-center justify-center font-mono text-xs text-terminal-gray">
              {rows.length === 0 ? "Awaiting first scan…" : "No symbols match the current filters."}
            </div>
          ) : (
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((vi) => {
                const row = sorted[vi.index];
                const starred = watchlist.symbolSet.has(row.symbol);
                return (
                  <div
                    key={row.symbol}
                    data-row-index={vi.index}
                    className="grid items-center border-b border-border/40 transition hover:bg-surface-low/40"
                    style={{
                      gridTemplateColumns: GRID_TEMPLATE,
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vi.start}px)`,
                      height: `${vi.size}px`,
                    }}
                    onClick={() => onSelectRow?.(row)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectRow?.(row);
                      }
                    }}
                  >
                    <div className="px-3 font-mono text-xs text-terminal-gray">
                      {String(vi.index + 1).padStart(2, "0")}
                    </div>
                    <div className="flex items-center gap-2 px-3">
                      <span className="font-mono font-semibold text-on-surface">{row.symbol}</span>
                      <ExchangeChip
                        exchange={row.exchange ?? exchangeFor(row.symbol)}
                      />
                    </div>
                    <div className="px-3 text-right font-mono tabular-nums text-on-surface">
                      {row.price.toFixed(2)}
                    </div>
                    <div className="px-3 text-right font-mono tabular-nums text-primary">
                      {row.spreadBps > 0 ? `${(row.spreadBps / 100).toFixed(2)}%` : "—"}
                    </div>
                    <div className="px-3 text-right font-mono tabular-nums text-on-surface-variant">
                      {row.relVol.toFixed(1)}x
                    </div>
                    <div className="flex justify-center px-3">
                      <MQLRBars
                        M={row.momentum}
                        Q={row.quality}
                        L={row.liquidity}
                        R={row.risk}
                      />
                    </div>
                    <div className="px-3 text-right font-mono tabular-nums text-on-surface">
                      {Math.round(row.confidence * 100)}%
                    </div>
                    <div className={cn("px-3 text-right font-mono tabular-nums", muTone(row.mu))}>
                      {row.mu >= 0 ? "+" : ""}
                      {row.mu.toFixed(1)}
                    </div>
                    <div className="px-3">
                      <RoleBadge role={row.role} />
                    </div>
                    <div
                      className={cn(
                        "px-3 text-right font-mono tabular-nums",
                        row.evidence >= 95 ? "text-on-surface" : "text-on-surface-variant",
                      )}
                    >
                      {Math.round(row.evidence)}
                    </div>
                    <div
                      className={cn(
                        "px-3 text-right font-mono tabular-nums",
                        row.mlScore != null && row.mlScore >= 60 ? "text-primary" : "text-error",
                      )}
                    >
                      {row.mlScore != null ? `${Math.round(row.mlScore)}%` : "—"}
                    </div>
                    <div className="px-3">
                      <GateBar modelEdge={row.modelEdge} required={row.cost} net={row.net} />
                    </div>
                    <div className="px-3">
                      <DecisionBadge decision={row.decision} />
                    </div>
                    <div
                      className="flex items-center justify-end gap-1 px-3"
                      // prevent row-click while interacting with the star
                      onClick={(e) => e.stopPropagation()}
                    >
                      <StarButton
                        symbol={row.symbol}
                        starred={starred}
                        onToggle={() => void watchlist.toggle(row.symbol)}
                        size="sm"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
