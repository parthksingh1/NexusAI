"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Children, cloneElement, forwardRef, isValidElement, type ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";

const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-all duration-150 ease-out-expo disabled:pointer-events-none disabled:opacity-50 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
  {
    variants: {
      variant: {
        primary:
          "bg-brand text-brand-fg shadow-sm hover:bg-brand-hover active:scale-[0.98] shadow-inset-top",
        secondary:
          "bg-bg-elevated text-fg border border-border hover:bg-bg-hover hover:border-border-strong active:scale-[0.98] shadow-sm",
        ghost:
          "text-fg-muted hover:bg-bg-hover hover:text-fg",
        danger:
          "bg-danger/90 text-white hover:bg-danger active:scale-[0.98] shadow-sm",
        outline:
          "border border-border bg-transparent text-fg hover:bg-bg-hover hover:border-border-strong",
        link:
          "text-brand underline-offset-4 hover:underline h-auto p-0",
      },
      size: {
        sm:  "h-8 px-3 text-xs",
        md:  "h-9 px-4 text-sm",
        lg:  "h-11 px-6 text-sm",
        icon: "h-9 w-9",
        "icon-sm": "h-7 w-7",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonStyles> & {
    loading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    asChild?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, leftIcon, rightIcon, children, disabled, asChild, ...props },
  ref,
) {
  const classes = cn(buttonStyles({ variant, size }), className);
  const leading = loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : leftIcon;
  const trailing = !loading ? rightIcon : null;

  // asChild: clone the single child and inject our icons inside it.
  // Slot requires exactly one React element child, so we merge leading/trailing
  // into that child's children rather than siblings.
  if (asChild) {
    try {
      const only = Children.only(children) as ReactElement<{ children?: React.ReactNode }>;
      if (!isValidElement(only)) return null;
      const merged = (
        <>
          {leading}
          {only.props.children}
          {trailing}
        </>
      );
      return (
        <Slot ref={ref as any} className={classes} {...(props as object)}>
          {cloneElement(only, undefined, merged)}
        </Slot>
      );
    } catch {
      // Fall through to the plain button if the child shape is unexpected
    }
  }

  return (
    <button ref={ref} disabled={disabled || loading} className={classes} {...props}>
      {leading}
      {children}
      {trailing}
    </button>
  );
});
