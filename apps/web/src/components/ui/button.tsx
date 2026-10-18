import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const actionText = "text-xs font-bold uppercase tracking-[0.14em]";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background",
  {
    variants: {
      variant: {
        default: `${actionText} bg-primary text-primary-foreground hover:bg-terminal-300`,
        secondary: `${actionText} border border-terminal-400/20 bg-terminal-400/10 text-terminal-300 hover:bg-terminal-400/15 hover:text-terminal-200`,
        outline: `${actionText} border border-terminal-400/40 bg-transparent text-terminal-300 hover:bg-terminal-400/10 hover:text-terminal-200`,
        destructive: `${actionText} border border-destructive bg-transparent text-destructive hover:bg-destructive/10`,
        ghost: "text-sm text-terminal-300/50 hover:text-terminal-300",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3",
        lg: "h-11 px-6",
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
