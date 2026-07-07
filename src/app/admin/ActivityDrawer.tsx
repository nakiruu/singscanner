"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useActivityPolling } from "./hooks/useActivityPolling";
import type { AdminActivityEvent } from "@/app/api/admin/activity/route";

interface Props {
  open: boolean;
  onClose: () => void;
  onSymbolClick?: (symbol: string) => void;
}

export function ActivityDrawer({ open, onClose, onSymbolClick }: Props) {
  const { events, loading, error } = useActivityPolling(open);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Activity feed"
      className="fixed right-0 top-16 z-40 flex h-[calc(100vh-4rem)] w-[320px] flex-col border-l border-border bg-surface-low shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="font-mono text-[11px] uppercase tracking-wider text-primary">▸ Activity</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close activity drawer"
          className="font-mono text-xs text-on-surface-variant hover:text-on-surface"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {loading && events.length === 0 && (
          <div className="font-mono text-[11px] text-on-surface-variant">loading…</div>
        )}
        {error && (
          <div className="font-mono text-[11px] text-error">error · {error}</div>
        )}
        {events.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            expanded={expandedId === e.id}
            onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
            onSymbolClick={onSymbolClick}
          />
        ))}
        {!loading && events.length === 0 && (
          <div className="font-mono text-[11px] text-on-surface-variant">quiet · no events in window</div>
        )}
      </div>
    </div>
  );
}

function EventRow({
  event, expanded, onToggle, onSymbolClick,
}: {
  event: AdminActivityEvent;
  expanded: boolean;
  onToggle: () => void;
  onSymbolClick?: (symbol: string) => void;
}) {
  const time = event.ts.slice(11, 16); // HH:MM

  const kindStyle: Record<AdminActivityEvent["kind"], string> = {
    "scan":     "text-primary",
    "star-in":  "text-tertiary",
    "star-out": "text-tertiary",
    "signup":   "text-secondary",
    "error":    "text-error",
  };

  const summary = renderSummary(event);

  return (
    <div className="border-b border-border/40 py-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[38px_58px_1fr] items-baseline gap-2 text-left font-mono text-[11px]"
      >
        <span className="text-on-surface-variant">{time}</span>
        <span className={cn(kindStyle[event.kind])}>{event.kind}</span>
        <span className="text-on-surface truncate">{summary}</span>
      </button>
      {expanded && (
        <div className="mt-1 rounded border border-border bg-surface-lowest px-2 py-1 font-mono text-[10px] text-on-surface-variant">
          {renderExpansion(event, onSymbolClick)}
        </div>
      )}
    </div>
  );
}

function renderSummary(e: AdminActivityEvent): string {
  switch (e.kind) {
    case "scan": return `${e.symbolsScanned} sym · ${e.primary} primary · ${e.stars} stars`;
    case "star-in":  return `${e.symbol} entered top-5`;
    case "star-out": return `${e.symbol} dropped from top-5`;
    case "signup": return `${e.email} (${e.role})`;
    case "error": return `${e.errKind} · ${e.message.slice(0, 60)}`;
  }
}

function renderExpansion(
  e: AdminActivityEvent,
  onSymbolClick?: (symbol: string) => void,
): React.ReactNode {
  switch (e.kind) {
    case "scan": return `snapshot @ ${e.ts}`;
    case "star-in":
    case "star-out":
      return onSymbolClick ? (
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => onSymbolClick(e.symbol)}
        >
          view {e.symbol} history →
        </button>
      ) : `symbol ${e.symbol}`;
    case "signup":
      return `user id: ${e.userId}`;
    case "error":
      return e.message;
  }
}
