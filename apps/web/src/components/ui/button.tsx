import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-terminal-300 font-mono font-bold",
        secondary:
          "border border-terminal-400/30 bg-secondary text-secondary-foreground hover:bg-accent font-mono",
        outline:
          "border border-primary bg-transparent text-primary hover:bg-primary hover:text-primary-foreground font-mono",
        destructive:
          "border border-destructive bg-transparent text-destructive hover:bg-destructive hover:text-primary-foreground font-mono",
        command:
          "rounded-none border border-terminal-400/60 bg-transparent text-xs font-semibold uppercase tracking-[0.14em] text-terminal-300 hover:bg-terminal-400/10 hover:text-terminal-200 disabled:opacity-40 font-mono",
        ghost: "text-terminal-300/50 hover:text-terminal-300 font-mono",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
