import { Badge } from "@/components/ui/badge";
import { decisionTone } from "@/lib/ui-helpers";
import type { Decision, ScanRow } from "@/lib/engine/types";
import { WhyDecisionPopover } from "./WhyDecisionPopover";

export interface DecisionBadgeProps {
  decision: Decision;
  className?: string;
  // Optional row context. When supplied, the badge is wrapped in a
  // WhyDecisionPopover explaining the top cost drivers + conviction.
  // Existing callers that only pass `decision` render unchanged.
  row?: ScanRow;
  horizon?: string;
}

// Tone mapping happens in ui-helpers → decisionTone; Badge handles the colors.
// When `row` is provided, the badge is hoverable/tappable with a full
// gate-decomposition popover — see WhyDecisionPopover for the content.
export function DecisionBadge({ decision, className, row, horizon }: DecisionBadgeProps) {
  const tone = decisionTone(decision);
  const badge = (
    <Badge tone={tone} className={className}>
      {decision}
    </Badge>
  );
  if (!row) return badge;
  return (
    <WhyDecisionPopover decision={decision} row={row} horizon={horizon}>
      {badge}
    </WhyDecisionPopover>
  );
}
