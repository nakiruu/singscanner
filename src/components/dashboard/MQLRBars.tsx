import { cn } from "@/lib/utils";
import { signalTier } from "@/lib/ui-helpers";

export interface MQLRBarsProps {
  M: number;
  Q: number;
  L: number;
  R: number;
  size?: "sm" | "md";
  className?: string;
}

const TIER_BG: Record<"high" | "mid" | "low", string> = {
  high: "bg-primary",
  mid: "bg-tertiary",
  low: "bg-error",
};

const LABELS: ReadonlyArray<"M" | "Q" | "L" | "R"> = ["M", "Q", "L", "R"];

export function MQLRBars({ M, Q, L, R, size = "sm", className }: MQLRBarsProps) {
  const values: Record<"M" | "Q" | "L" | "R", number> = { M, Q, L, R };
  const segWidth = size === "sm" ? "w-3" : "w-4";
  const segHeight = size === "sm" ? "h-3" : "h-4";

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {LABELS.map((k) => {
        const v = values[k];
        const tier = signalTier(v);
        return (
          <span
            key={k}
            title={`${k}: ${v}`}
            className={cn(
              "rounded-sm",
              segWidth,
              segHeight,
              TIER_BG[tier]
            )}
          />
        );
      })}
    </div>
  );
}
