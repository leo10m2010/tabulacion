import * as React from "react";
import { cn } from "../../lib/utils";

type ButtonVariant = "default" | "outline" | "ghost" | "danger";
type ButtonSize = "default" | "sm" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground shadow-glow hover:brightness-105 disabled:opacity-60",
  outline:
    "border border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-60",
  ghost:
    "text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-60",
  // bg-danger-deep (no bg-danger): con texto blanco encima, --danger en modo
  // oscuro solo llega a 3.94:1 (bajo AA); danger-deep está calibrado para esto.
  danger:
    "bg-danger-deep text-danger-foreground hover:brightness-105 disabled:opacity-60",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-10 px-4 py-2",
  sm: "h-8 px-3 text-sm",
  lg: "h-11 px-6 text-base",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition duration-150 active:translate-y-px active:scale-[0.985] disabled:cursor-not-allowed disabled:active:translate-y-0 disabled:active:scale-100",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);

Button.displayName = "Button";
