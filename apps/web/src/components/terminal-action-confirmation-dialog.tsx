"use client";

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useTypedLines } from "@/hooks/use-typed-lines";

const ACTION_TEXT_ENTER_DELAY_MS = 140;

export type TerminalActionConfirmationSpec = {
  title: string;
  command: string;
  lines: string[];
  confirmLabel?: string;
};

type TerminalActionConfirmationDialogProps = {
  confirmation: TerminalActionConfirmationSpec | null;
  isPending: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
};

function TypedConfirmationLines({ lines }: { lines: string[] }) {
  const { renderedLines, activeLineIndex } = useTypedLines(
    lines,
    ACTION_TEXT_ENTER_DELAY_MS,
  );

  return (
    <AlertDialogDescription asChild>
      <div className="min-h-20 space-y-1 text-terminal-200">
        {renderedLines.map((line, index) => (
          <div
            key={index}
            className="min-h-5 whitespace-pre-wrap break-words leading-6"
          >
            {line}
            {activeLineIndex === index ? (
              <span className="ml-1 inline-block h-4 w-2 animate-pulse align-[-2px] bg-terminal-300" />
            ) : null}
          </div>
        ))}
      </div>
    </AlertDialogDescription>
  );
}

export function TerminalActionConfirmationDialog({
  confirmation,
  isPending,
  confirmDisabled = false,
  children,
  onCancel,
  onConfirm,
}: TerminalActionConfirmationDialogProps) {
  if (!confirmation) {
    return null;
  }

  const lines = [`> ${confirmation.command}`, ...confirmation.lines];

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
          <AlertDialogCloseButton
            aria-label="Close confirmation"
            disabled={isPending}
            onClick={onCancel}
          />
        </AlertDialogHeader>
        <AlertDialogBody className="text-sm">
          <TypedConfirmationLines key={lines.join("\n")} lines={lines} />
          {children}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <Button
              disabled={isPending || confirmDisabled}
              type="button"
              onClick={onConfirm}
            >
              {confirmation.confirmLabel ?? "Confirm"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogBody>
      </AlertDialogContent>
    </AlertDialog>
  );
}
