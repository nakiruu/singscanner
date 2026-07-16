// ConfidenceDots — 4-dot indicator of model conviction.
//
// Reads the same row.confidence value the WhyDecisionPopover uses. Maps
// [0, 1] → 0..4 filled dots via floor(confidence * 4 + 0.5), giving:
//   0.00-0.12 → 0 dots
//   0.13-0.37 → 1 dot
//   0.38-0.62 → 2 dots
//   0.63-0.87 → 3 dots
//   0.88-1.00 → 4 dots
//
// Colored to match the qualitative conviction thresholds used elsewhere:
// HIGH ≥ 0.7 = success, MEDIUM 0.4-0.7 = primary, LOW < 0.4 = variant.

import { cn } from "@/lib/utils";

export interface ConfidenceDotsProps {
  confidence: number;
  className?: string;
  ariaLabel?: string;
}

function toneOf(confidence: number): string {
  if (confidence >= 0.7) return "bg-success";
  if (confidence >= 0.4) return "bg-primary";
  return "bg-on-surface-variant";
}

export function ConfidenceDots({
  confidence,
  className,
  ariaLabel,
}: ConfidenceDotsProps) {
  const clamped = Math.max(0, Math.min(1, confidence));
  const filled = Math.max(0, Math.min(4, Math.floor(clamped * 4 + 0.5)));
  const tone = toneOf(clamped);

  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      role="img"
      aria-label={
        ariaLabel ?? `Confidence: ${filled} of 4 (${(clamped * 100).toFixed(0)}%)`
      }
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full transition-colors",
            i < filled ? tone : "bg-surface-high",
          )}
        />
      ))}
    </span>
  );
}
