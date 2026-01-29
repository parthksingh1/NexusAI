import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeStyles = cva(
  "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-bg-muted text-fg-muted border-border",
        brand:   "bg-brand-muted text-brand border-brand-border",
        success: "bg-success/10 text-success border-success/20",
        warn:    "bg-warn/10 text-warn border-warn/20",
        danger:  "bg-danger/10 text-danger border-danger/20",
        info:    "bg-info/10 text-info border-info/20",
      },
      size: {
        sm: "px-2 py-0.5 text-2xs",
        md: "px-2.5 py-0.5 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeStyles> & {
  dot?: boolean;
  pulse?: boolean;
};

export function Badge({ className, tone, size, dot, pulse, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeStyles({ tone, size }), className)} {...props}>
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "success" && "bg-success",
            tone === "warn" && "bg-warn",
            tone === "danger" && "bg-danger",
            tone === "info" && "bg-info",
            tone === "brand" && "bg-brand",
            (!tone || tone === "neutral") && "bg-fg-subtle",
            pulse && "animate-pulse-dot",
          )}
        />
      )}
      {children}
    </span>
  );
}
