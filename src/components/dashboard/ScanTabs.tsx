"use client";

import { Columns, Grid3X3, LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type ScanView = "live" | "stream" | "exec" | "matrix";

export interface ScanTabsProps {
  value: ScanView;
  onChange: (v: ScanView) => void;
}

const TABS: Array<{
  id: ScanView;
  label: string;
  Icon: typeof List;
}> = [
  { id: "live", label: "Live Terminal", Icon: List },
  { id: "stream", label: "Vertical Stream", Icon: Columns },
  { id: "exec", label: "Executive Dashboard", Icon: LayoutGrid },
  { id: "matrix", label: "Matrix Grid", Icon: Grid3X3 },
];

export function ScanTabs({ value, onChange }: ScanTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Scanner view"
      className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3"
    >
      {TABS.map(({ id, label, Icon }) => {
        const active = id === value;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition",
              active
                ? "bg-primary text-on-primary shadow-[0_0_18px_rgba(62,207,142,0.25)]"
                : "text-on-surface-variant hover:bg-surface-low hover:text-on-surface"
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
