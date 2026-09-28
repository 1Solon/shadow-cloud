"use client";

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import {
  dialogContentClassName,
  dialogOverlayClassName,
  useReturnFocus,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function AlertDialog(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Root>,
) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogContent({
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  const autoFocusHandlers = useReturnFocus({
    onOpenAutoFocus,
    onCloseAutoFocus,
  });

  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay
        data-slot="alert-dialog-overlay"
        className={dialogOverlayClassName}
      />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(dialogContentClassName, className)}
        {...autoFocusHandlers}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogTitle(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Title>,
) {
  return (
    <AlertDialogPrimitive.Title data-slot="alert-dialog-title" {...props} />
  );
}

function AlertDialogDescription(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Description>,
) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      {...props}
    />
  );
}

function AlertDialogCancel({
  variant = "secondary",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
  Pick<React.ComponentProps<typeof Button>, "variant">) {
  return (
    <Button variant={variant} asChild>
      <AlertDialogPrimitive.Cancel data-slot="alert-dialog-cancel" {...props} />
    </Button>
  );
}

export {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
};
export {
  DialogBody as AlertDialogBody,
  DialogCloseButton as AlertDialogCloseButton,
  DialogFooter as AlertDialogFooter,
  DialogHeader as AlertDialogHeader,
} from "@/components/ui/dialog";
