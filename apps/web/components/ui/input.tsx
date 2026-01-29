import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9 w-full rounded-md border border-border bg-bg-elevated px-3 text-sm",
          "placeholder:text-fg-subtle",
          "transition-colors focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm",
          "placeholder:text-fg-subtle",
          "transition-colors focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25",
          "disabled:opacity-50 disabled:cursor-not-allowed resize-none",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-xs font-medium text-fg-muted mb-1.5", className)} {...props} />;
}
