import * as React from "react";
import { cn } from "../../lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "muted" | "danger";
}

const classes: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: "bg-primary/15 text-primary border-primary/30",
  muted: "bg-muted text-muted-foreground border-border",
  danger: "bg-danger/15 text-danger border-danger/30",
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        classes[variant],
        className,
      )}
      {...props}
    />
  );
}
