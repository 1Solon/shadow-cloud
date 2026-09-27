import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-terminal-400/30 bg-background px-3 font-mono text-sm text-terminal-200 outline-none transition-colors placeholder:text-terminal-300/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 file:mr-3 file:border-0 file:bg-primary file:px-3 file:py-1 file:font-mono file:text-xs file:font-bold file:text-primary-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
