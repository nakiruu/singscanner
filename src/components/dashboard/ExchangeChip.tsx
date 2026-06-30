import { cn } from "@/lib/utils";

export interface ExchangeChipProps {
  exchange?: string;
  className?: string;
}

export function ExchangeChip({ exchange = "NAS", className }: ExchangeChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border border-border bg-surface-low px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant",
        className
      )}
    >
      {exchange}
    </span>
  );
}
