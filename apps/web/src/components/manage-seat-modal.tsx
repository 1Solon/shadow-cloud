"use client";

import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ManageSeatModalSeat = {
  id: string;
  seatNumber: number;
  playerLabel: string;
  isActive: boolean;
  isEmpty: boolean;
  canClear: boolean;
  canRemove: boolean;
  requiresSavedClearBeforeRemove: boolean;
};

type ManageSeatModalProps = {
  seat: ManageSeatModalSeat | null;
  isPending: boolean;
  onClose: () => void;
  onMakeActive: () => void;
  onClear: () => void;
  onRemove: () => void;
};

type SeatActionProps = {
  title: string;
  description: string;
  disabled: boolean;
  destructive?: boolean;
  onClick: () => void;
};

function SeatAction({
  title,
  description,
  disabled,
  destructive = false,
  onClick,
}: SeatActionProps) {
  const descriptionId = useId();

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between",
        destructive
          ? "border-destructive/20 bg-destructive/5"
          : "border-terminal-400/20 bg-terminal-400/5",
      )}
    >
      <div className="min-w-0">
        <div
          className={cn(
            "font-mono font-semibold",
            destructive ? "text-destructive" : "text-terminal-200",
          )}
        >
          {title}
        </div>
        <p
          className={cn(
            "mt-1 break-words text-sm leading-6",
            destructive ? "text-destructive/70" : "text-terminal-200/70",
          )}
          id={descriptionId}
        >
          {description}
        </p>
      </div>
      <Button
        aria-describedby={descriptionId}
        className="w-full shrink-0 sm:w-32"
        data-seat-action="true"
        disabled={disabled}
        type="button"
        variant={destructive ? "destructive" : "secondary"}
        onClick={onClick}
      >
        {title}
      </Button>
    </div>
  );
}

export function ManageSeatModal({
  seat,
  isPending,
  onClose,
  onMakeActive,
  onClear,
  onRemove,
}: ManageSeatModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  if (!seat) {
    return null;
  }

  const makeActiveDescription = seat.isEmpty
    ? "An empty seat cannot be made active."
    : seat.isActive
      ? "This seat is already active."
      : `Set seat ${seat.seatNumber} as the current turn.`;
  const clearDescription = seat.isEmpty
    ? "This seat is already empty."
    : !seat.canClear
      ? "At least one occupied seat must remain."
      : `Remove ${seat.playerLabel} but keep seat ${seat.seatNumber} in the turn order.`;
  const removeDescription = seat.requiresSavedClearBeforeRemove
    ? "Save the cleared seat before removing it."
    : !seat.isEmpty
      ? "Only empty seats can be removed."
      : !seat.canRemove
        ? "This seat cannot be removed."
        : "Delete this empty seat and renumber the remaining seats.";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        ref={contentRef}
        aria-describedby={undefined}
        className="flex max-h-[calc(100vh-3rem)] max-w-xl flex-col"
        onOpenAutoFocus={(event) => {
          const firstAction = contentRef.current?.querySelector<HTMLElement>(
            'button[data-seat-action="true"]:not([disabled])',
          );
          if (firstAction) {
            event.preventDefault();
            firstAction.focus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Manage seat {seat.seatNumber}</DialogTitle>
          <DialogCloseButton
            aria-label="Close manage seat"
            disabled={isPending}
            onClick={onClose}
          />
        </DialogHeader>
        <DialogBody className="min-h-0 overflow-y-auto sm:px-5 sm:py-5">
          <div className="min-w-0 border-b border-terminal-400/20 px-1 pb-4 text-xl font-semibold text-terminal-300 [overflow-wrap:anywhere]">
            {seat.playerLabel}
          </div>
          <div className="space-y-3">
            <SeatAction
              description={makeActiveDescription}
              disabled={isPending || seat.isEmpty || seat.isActive}
              title="Make active"
              onClick={onMakeActive}
            />
            <SeatAction
              description={clearDescription}
              disabled={isPending || !seat.canClear}
              title="Clear seat"
              onClick={onClear}
            />
            <SeatAction
              destructive
              description={removeDescription}
              disabled={isPending || !seat.canRemove}
              title="Remove seat"
              onClick={onRemove}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={isPending}
              type="button"
              variant="secondary"
              onClick={onClose}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
