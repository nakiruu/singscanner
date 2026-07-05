import { Badge } from "@/components/ui/badge";
import { decisionTone } from "@/lib/ui-helpers";
import type { Decision } from "@/lib/engine/types";

export interface DecisionBadgeProps {
  decision: Decision;
  className?: string;
}

// Tone mapping happens in ui-helpers → decisionTone; Badge handles the colors.
export function DecisionBadge({ decision, className }: DecisionBadgeProps) {
  const tone = decisionTone(decision);
  return (
    <Badge tone={tone} className={className}>
      {decision}
    </Badge>
  );
}
