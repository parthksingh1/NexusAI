import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }>(
  function Card({ className, interactive, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-lg border border-border bg-bg-elevated shadow-sm ring-inset-subtle",
          interactive && "transition-all duration-200 ease-out-expo hover:border-border-strong hover:shadow-md hover:-translate-y-0.5 cursor-pointer",
          className,
        )}
        {...props}
      />
    );
  },
);

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 pt-5 pb-4 flex items-start justify-between gap-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-semibold tracking-tight text-[15px]", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-fg-muted mt-1", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-4 border-t border-border flex items-center gap-3", className)} {...props} />;
}
