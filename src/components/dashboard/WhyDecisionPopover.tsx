// WhyDecisionPopover — hover/tap explanation of a gate decision.
//
// Per NN/G AI-uncertainty guidance + Padilla et al. 2021 (PMC7868089),
// qualitative uncertainty explanations outperform raw confidence intervals
// for lay users making decisions under time pressure. This popover surfaces
// the top cost contributors, a qualitative conviction label, and the
// evidence score — instead of forcing users to read cEntry/cExit numbers.
//
// Wraps a DecisionBadge. Zero backend work — all inputs already flow
// through ScanRow. Ships as UI-Week-1.

"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Decision, ScanRow } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

interface CostContribution {
  label: string;
  bps: number;   // magnitude, always ≥ 0
}

// Rank the cost components on a ScanRow by |bps| and return the top-N.
// Uses the breakdown from B3-F3 (cEntry, cExit, cQueue, cMemory,
// concentrationBps) already exposed on the row.
function topCostContributors(row: ScanRow, n = 3): CostContribution[] {
  const all: CostContribution[] = [
    { label: "Entry costs", bps: row.cEntry },
    { label: "Exit reserve", bps: row.cExit },
    { label: "Queue / stale-quote", bps: row.cQueue },
    { label: "Action memory", bps: row.cMemory },
    { label: "Concentration", bps: row.concentrationBps },
  ];
  return all
    .filter((c) => c.bps > 0.05)   // drop near-zero contributions
    .sort((a, b) => b.bps - a.bps)
    .slice(0, n);
}

// Qualitative conviction label from the row's confidence score in [0, 1].
// Per Padilla et al. — plain-English labels outperform raw CIs for lay
// users under time pressure.
function convictionLabel(confidence: number): { label: string; tone: string } {
  if (confidence >= 0.7) return { label: "HIGH", tone: "text-success" };
  if (confidence >= 0.4) return { label: "MEDIUM", tone: "text-primary" };
  return { label: "LOW", tone: "text-on-surface-variant" };
}

// Evidence-count bucket. Rough proxy for sample-size confidence pending
// full posterior/n_eff plumbing at row level.
function evidenceBucket(evidence: number): string {
  if (evidence >= 400) return "strong evidence";
  if (evidence >= 200) return "enough to trust";
  if (evidence >= 80) return "warming up";
  return "sparse";
}

interface WhyDecisionPopoverProps {
  decision: Decision;
  row: ScanRow;
  horizon?: string;
  children: React.ReactNode;   // typically <DecisionBadge>
  className?: string;
}

export function WhyDecisionPopover({
  decision,
  row,
  horizon,
  children,
  className,
}: WhyDecisionPopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverId = useId();

  // Click-outside + Escape to close. Standard pattern.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const openNow = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  }, []);

  const closeSoon = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpen(false), 100);
  }, []);

  const conviction = convictionLabel(row.confidence);
  const contributors = topCostContributors(row, 3);
  const netSign = row.net >= 0 ? "+" : "";
  const modelEdgeSign = row.modelEdge >= 0 ? "+" : "";

  return (
    <span
      ref={wrapperRef}
      className={cn("relative inline-block", className)}
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={closeSoon}
    >
      <button
        type="button"
        aria-label={`Why ${decision}?`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((v) => !v)}
        className="cursor-help border-0 bg-transparent p-0 leading-none"
      >
        {children}
      </button>

      {open && (
        <div
          id={popoverId}
          role="tooltip"
          className={cn(
            "absolute left-0 top-full z-50 mt-2 w-72",
            "rounded-md border border-border bg-surface-lowest shadow-lg",
            "p-3 font-mono text-[11px] text-on-surface",
            // ensure the popover sits above adjacent overflow: hidden containers
            "before:absolute before:-top-1 before:left-3 before:h-2 before:w-2",
            "before:rotate-45 before:border-l before:border-t before:border-border",
            "before:bg-surface-lowest before:content-['']",
          )}
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
        >
          <div className="mb-2 text-[10px] uppercase tracking-wider text-on-surface-variant">
            Why {decision}?
          </div>

          <div className="mb-2 flex items-baseline justify-between border-b border-border/50 pb-2">
            <span className="text-on-surface-variant">Signal edge</span>
            <span className="tabular-nums text-on-surface">
              {modelEdgeSign}
              {row.modelEdge.toFixed(1)} bps
            </span>
          </div>

          {contributors.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-on-surface-variant">
                Top costs
              </div>
              <ul className="space-y-1">
                {contributors.map((c) => (
                  <li key={c.label} className="flex items-baseline justify-between">
                    <span className="text-on-surface-variant">• {c.label}</span>
                    <span className="tabular-nums text-error">
                      −{c.bps.toFixed(1)} bps
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-2 flex items-baseline justify-between border-t border-border/50 pt-2">
            <span className="text-on-surface-variant">Net edge</span>
            <span
              className={cn(
                "tabular-nums font-semibold",
                row.net >= 0 ? "text-success" : "text-error",
              )}
            >
              {netSign}
              {row.net.toFixed(1)} bps
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
            <div>
              <div className="uppercase tracking-wider text-on-surface-variant">
                Conviction
              </div>
              <div className={cn("mt-0.5 font-semibold", conviction.tone)}>
                {conviction.label}
              </div>
            </div>
            <div>
              <div className="uppercase tracking-wider text-on-surface-variant">
                Evidence
              </div>
              <div className="mt-0.5 tabular-nums text-on-surface">
                {row.evidence.toFixed(0)}{" "}
                <span className="text-on-surface-variant">
                  ({evidenceBucket(row.evidence)})
                </span>
              </div>
            </div>
          </div>

          {horizon && (
            <div className="mt-2 text-[10px] uppercase tracking-wider text-on-surface-variant">
              Horizon: {horizon}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
