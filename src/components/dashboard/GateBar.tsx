import { cn } from "@/lib/utils";

export interface GateBarProps {
  modelEdge: number;
  required: number;
  net: number;
  /** Track width in pixels. Default 190. */
  width?: number;
  className?: string;
}

/**
 * Signature gate visualisation.
 * - Emerald fill grows from the left and represents modelEdge / required (0-130%).
 * - White 2px tick marks the required position (the "cost wall").
 * - If net > 0, a green segment shows past the wall.
 * - If net < 0, a red segment shows the deficit before the wall.
 * - Right-side numeric label shows +net (green) or -deficit (red) in bps.
 */
export function GateBar({
  modelEdge,
  required,
  net,
  width = 190,
  className,
}: GateBarProps) {
  const safeRequired = Math.max(1, required);
  const fillPctRaw = (modelEdge / safeRequired) * 100;
  const fillPct = Math.max(0, Math.min(130, fillPctRaw));
  // Cap fill display at 100% so the bar never visually overruns the track.
  const fillDisplay = Math.min(100, fillPct);

  // Wall is always rendered at 100% of the visible required slot.
  const wallPct = 100;

  const positive = net > 0;
  const overflowPct = Math.max(
    0,
    Math.min(30, Math.abs(net) / safeRequired * 100)
  );

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      style={{ minWidth: width + 56 }}
    >
      <div
        className="relative h-2 overflow-hidden rounded-sm bg-surface-low"
        style={{ width }}
      >
        {/* Emerald fill — modelEdge progress */}
        <div
          className="absolute left-0 top-0 h-full bg-primary/80"
          style={{ width: `${fillDisplay}%` }}
        />

        {/* Deficit (red) — shown just left of wall when net < 0 */}
        {!positive && net < 0 && (
          <div
            className="absolute top-0 h-full bg-error/80"
            style={{
              right: `${wallPct - 100}%`,
              width: `${overflowPct}%`,
              transform: "translateX(0)",
            }}
          />
        )}

        {/* Overflow (green) — shown just right of wall when net > 0 */}
        {positive && (
          <div
            className="absolute top-0 h-full bg-primary"
            style={{
              left: `${wallPct}%`,
              width: `${overflowPct}%`,
            }}
          />
        )}

        {/* Required tick (white 2px) */}
        <div
          className="absolute top-0 h-full w-[2px] bg-on-surface"
          style={{ left: `calc(${wallPct}% - 1px)` }}
        />
      </div>

      <span
        className={cn(
          "min-w-[3.5rem] text-right font-mono text-xs tabular-nums",
          positive ? "text-primary" : "text-error"
        )}
      >
        {positive ? "+" : ""}
        {net.toFixed(1)}
      </span>
    </div>
  );
}
