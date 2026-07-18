"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
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
          ? "border-red-400/20 bg-red-400/5"
          : "border-orange-400/20 bg-orange-400/5",
      )}
    >
      <div className="min-w-0">
        <div
          className={cn(
            "font-mono font-semibold",
            destructive ? "text-red-200" : "text-orange-200",
          )}
        >
          {title}
        </div>
        <p
          className={cn(
            "mt-1 break-words text-sm leading-6",
            destructive ? "text-red-200/70" : "text-orange-200/70",
          )}
          id={descriptionId}
        >
          {description}
        </p>
      </div>
      <Button
        aria-describedby={descriptionId}
        className={cn(
          "w-full shrink-0 sm:w-32",
          destructive
            ? "border-red-400 text-red-300 hover:bg-red-400 hover:text-black"
            : null,
        )}
        data-seat-action="true"
        disabled={disabled}
        type="button"
        variant={destructive ? "outline" : "secondary"}
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const seatId = seat?.id;

  useEffect(() => {
    if (!seatId) {
      return;
    }

    function containFocus(event: FocusEvent) {
      if (
        event.target instanceof Node &&
        !dialogRef.current?.contains(event.target)
      ) {
        closeButtonRef.current?.focus();
      }
    }

    const firstAction = dialogRef.current?.querySelector<HTMLButtonElement>(
      'button[data-seat-action="true"]:not([disabled])',
    );
    (firstAction ?? closeButtonRef.current)?.focus();
    document.addEventListener("focusin", containFocus);

    return () => {
      document.removeEventListener("focusin", containFocus);
    };
  }, [seatId]);

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

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !isPending) {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const first = focusableElements[0];
    const last = focusableElements.at(-1);

    if (!first || !last) {
      event.preventDefault();
      return;
    }

    if (
      (event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last) ||
      !dialogRef.current?.contains(document.activeElement)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onClose();
        }
      }}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative max-h-[calc(100vh-3rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-orange-400/30 bg-[#0a0711] shadow-2xl shadow-orange-950/40"
        ref={dialogRef}
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-orange-400/20 bg-[#1f1110] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-orange-200">
          <span id={titleId}>Manage seat {seat.seatNumber}</span>
          <button
            aria-label="Close manage seat"
            className="text-orange-300/70 transition-colors hover:text-orange-200 disabled:opacity-50"
            disabled={isPending}
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
          >
            X
          </button>
        </div>
        <div className="space-y-4 bg-black/70 px-4 py-4 font-mono text-orange-300 sm:px-5 sm:py-5">
          <div className="min-w-0 border-b border-orange-400/15 px-1 pb-4 text-xl font-semibold text-orange-300 [overflow-wrap:anywhere]">
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
          <div className="flex justify-end pt-1">
            <Button
              disabled={isPending}
              type="button"
              variant="secondary"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
