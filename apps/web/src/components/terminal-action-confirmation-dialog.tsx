"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

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
  onCancel: () => void;
  onConfirm: () => void;
};

export function TerminalActionConfirmationDialog({
  confirmation,
  isPending,
  onCancel,
  onConfirm,
}: TerminalActionConfirmationDialogProps) {
  const [renderedLines, setRenderedLines] = useState<string[]>([]);
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);
  const timeoutIdsRef = useRef<number[]>([]);

  function clearScheduledTimeouts() {
    timeoutIdsRef.current.forEach((timeoutId) =>
      window.clearTimeout(timeoutId),
    );
    timeoutIdsRef.current = [];
  }

  function scheduleTimeout(callback: () => void, delay: number) {
    const timeoutId = window.setTimeout(callback, delay);
    timeoutIdsRef.current.push(timeoutId);
  }

  useEffect(
    () => () => {
      clearScheduledTimeouts();
    },
    [],
  );

  useEffect(() => {
    if (!confirmation) {
      clearScheduledTimeouts();
      scheduleTimeout(() => {
        setRenderedLines([]);
        setActiveLineIndex(null);
      }, 0);

      return () => {
        clearScheduledTimeouts();
      };
    }

    const terminalLines = [`> ${confirmation.command}`, ...confirmation.lines];
    let elapsed = ACTION_TEXT_ENTER_DELAY_MS;

    clearScheduledTimeouts();
    scheduleTimeout(() => {
      setRenderedLines([]);
      setActiveLineIndex(null);
    }, 0);

    terminalLines.forEach((line, lineIndex) => {
      for (let charIndex = 1; charIndex <= line.length; charIndex += 1) {
        const snapshot = [
          ...terminalLines.slice(0, lineIndex),
          line.slice(0, charIndex),
        ];

        scheduleTimeout(() => {
          setRenderedLines(snapshot);
          setActiveLineIndex(lineIndex);
        }, elapsed);
        elapsed += lineIndex === 0 ? 18 : 12;
      }

      elapsed += 110;
    });

    scheduleTimeout(() => {
      setRenderedLines(terminalLines);
      setActiveLineIndex(null);
    }, elapsed);

    return () => {
      clearScheduledTimeouts();
    };
  }, [confirmation]);

  if (!confirmation) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-orange-400/30 bg-[#0a0711] shadow-2xl shadow-orange-950/40">
        <div className="flex items-center justify-between border-b border-orange-400/20 bg-orange-400/10 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-orange-200">
          <span>{confirmation.title}</span>
          <button
            aria-label="Close confirmation"
            className="text-orange-300/70 transition-colors hover:text-orange-200"
            type="button"
            onClick={onCancel}
          >
            X
          </button>
        </div>
        <div className="space-y-4 bg-black/70 px-4 py-4 font-mono text-sm text-orange-300">
          <div className="min-h-20 space-y-1 text-orange-200/85">
            {renderedLines.map((line, index) => (
              <div
                key={`${confirmation.command}-${index}`}
                className="min-h-5 whitespace-pre-wrap break-words leading-6"
              >
                {line}
                {activeLineIndex === index ? (
                  <span className="ml-1 inline-block h-4 w-2 animate-pulse align-[-2px] bg-orange-300" />
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              disabled={isPending}
              type="button"
              variant="secondary"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button disabled={isPending} type="button" onClick={onConfirm}>
              {confirmation.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
