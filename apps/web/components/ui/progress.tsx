"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Progress = forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { tone?: "brand" | "warn" | "danger" }
>(({ className, value, tone = "brand", ...props }, ref) => {
  const toneClass = { brand: "bg-brand", warn: "bg-warn", danger: "bg-danger" }[tone];
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-bg-hover", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full transition-transform duration-500 ease-out-expo", toneClass)}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = "Progress";
