import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { decisionTone } from "@/lib/ui-helpers";
import type { Decision } from "@/lib/engine/types";

export interface DecisionBadgeProps {
  decision: Decision;
  className?: string;
}

const INFO_CLASS =
  "border-[#4F9DF0]/40 bg-[#4F9DF0]/10 text-[#4F9DF0]";

export function DecisionBadge({ decision, className }: DecisionBadgeProps) {
  const tone = decisionTone(decision);

  if (tone === "info") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
          INFO_CLASS,
          className
        )}
      >
        {decision}
      </span>
    );
  }

  return (
    <Badge tone={tone === "primary" ? "primary" : tone === "warn" ? "warn" : "error"} className={className}>
      {decision}
    </Badge>
  );
}
