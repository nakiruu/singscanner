import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
  {
    variants: {
      tone: {
        primary: "border-primary/40 bg-primary/10 text-primary",
        neutral: "border-border bg-surface-low text-on-surface-variant",
        warn: "border-tertiary/40 bg-tertiary/10 text-tertiary",
        error: "border-error/40 bg-error/10 text-error",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  led?: boolean;
}

export function Badge({ className, tone, led, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {led && <span className="led-pulse h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
