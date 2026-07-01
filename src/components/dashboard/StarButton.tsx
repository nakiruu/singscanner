"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StarButtonProps {
  symbol: string;
  starred: boolean;
  onToggle: (symbol: string) => void | Promise<void>;
  size?: "sm" | "md";
}

export function StarButton({ symbol, starred, onToggle, size = "sm" }: StarButtonProps) {
  const dim = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const box = size === "md" ? "h-7 w-7" : "h-6 w-6";
  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={starred ? `Unstar ${symbol}` : `Star ${symbol}`}
      onClick={() => {
        void onToggle(symbol);
      }}
      className={cn(
        "inline-flex items-center justify-center rounded transition",
        box,
        starred
          ? "text-emerald-400 hover:text-emerald-300"
          : "text-on-surface-variant hover:text-on-surface",
      )}
    >
      <Star
        className={cn(dim, starred && "fill-emerald-400")}
        aria-hidden="true"
      />
    </button>
  );
}
