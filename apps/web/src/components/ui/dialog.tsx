"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const dialogOverlayClassName = "fixed inset-0 z-50 bg-surface/70";

const dialogContentClassName =
  "fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-terminal-400/30 bg-popover font-mono shadow-2xl shadow-terminal-950/40 outline-none";

type AutoFocusHandlers = {
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

function useReturnFocus({
  onOpenAutoFocus,
  onCloseAutoFocus,
}: AutoFocusHandlers): Required<AutoFocusHandlers> {
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  return {
    onOpenAutoFocus(event) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus(event) {
      onCloseAutoFocus?.(event);
      if (!event.defaultPrevented) {
        event.preventDefault();
        returnFocusRef.current?.focus();
      }
    },
  };
}

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogContent({
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const autoFocusHandlers = useReturnFocus({
    onOpenAutoFocus,
    onCloseAutoFocus,
  });

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={dialogOverlayClassName}
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(dialogContentClassName, className)}
        {...autoFocusHandlers}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex items-center justify-between gap-4 border-b border-terminal-400/20 bg-terminal-400/10 px-4 py-3 text-[11px] uppercase tracking-[0.28em] text-terminal-200",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle(
  props: React.ComponentProps<typeof DialogPrimitive.Title>,
) {
  return <DialogPrimitive.Title data-slot="dialog-title" {...props} />;
}

function DialogCloseButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="dialog-close-button"
      className={cn(
        "rounded-sm text-terminal-300/70 transition-colors hover:text-terminal-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50",
        className,
      )}
      {...props}
    >
      X
    </button>
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        "space-y-4 bg-surface/70 px-4 py-4 text-terminal-300",
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex justify-end gap-2 pt-2", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  dialogContentClassName,
  dialogOverlayClassName,
  useReturnFocus,
};
