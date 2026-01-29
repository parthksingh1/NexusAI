import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-dashed border-border bg-bg-subtle/50 py-16 px-6 flex flex-col items-center justify-center text-center", className)}>
      {Icon && (
        <div className="h-11 w-11 rounded-xl bg-bg-muted border border-border flex items-center justify-center mb-4">
          <Icon className="h-5 w-5 text-fg-muted" />
        </div>
      )}
      <h3 className="font-semibold tracking-tight">{title}</h3>
      {description && <p className="mt-1.5 text-sm text-fg-muted max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
