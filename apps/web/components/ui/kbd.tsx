import { cn } from "@/lib/cn";

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-bg-muted px-1 font-mono text-2xs text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}
