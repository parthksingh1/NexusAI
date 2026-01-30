import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";

export function Stat({
  label, value, icon: Icon, delta, hint, className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  delta?: { value: string; positive?: boolean };
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn(
      "rounded-lg border border-border bg-bg-elevated p-5 ring-inset-subtle shadow-sm",
      "hover:shadow-md hover:border-border-strong transition-all duration-200 ease-out-expo",
      className,
    )}>
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold text-fg-muted uppercase tracking-wider">{label}</span>
        {Icon && <Icon className="h-3.5 w-3.5 text-fg-subtle" />}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <div className="text-2xl font-semibold tracking-tighter">{value}</div>
        {delta && (
          <span className={cn(
            "inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-md",
            delta.positive ? "text-success bg-success/10" : "text-danger bg-danger/10",
          )}>
            {delta.positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta.value}
          </span>
        )}
      </div>
      {hint && <div className="text-xs text-fg-subtle mt-1">{hint}</div>}
    </div>
  );
}
