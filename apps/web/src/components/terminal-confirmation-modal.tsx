"use client";

import { useEffect, useRef, useState } from "react";
import { useTypedLines } from "@/hooks/use-typed-lines";

const ENTER_DURATION_MS = 260;
const FADE_DURATION_MS = 260;
type TerminalPhase = "enter" | "visible" | "exit";

export type TerminalConfirmationSpec = {
  title?: string;
  command: string;
  lines: string[];
  titleTone?: "orange" | "green";
};

type TerminalConfirmationModalProps = {
  confirmation: TerminalConfirmationSpec | null;
  onClose?: () => void;
};

type TerminalConfirmationSurfaceProps = {
  confirmation: TerminalConfirmationSpec;
  onClose?: () => void;
};

function isStatusLine(line: string) {
  return line.startsWith("<") && line.endsWith(">");
}

function TerminalConfirmationSurface({
  confirmation,
  onClose,
}: TerminalConfirmationSurfaceProps) {
  const [phase, setPhase] = useState<TerminalPhase>("enter");
  const [isClosed, setIsClosed] = useState(false);
  const timeoutIdsRef = useRef<number[]>([]);
  const { renderedLines, activeLineIndex } = useTypedLines(
    [`> ${confirmation.command}`, ...confirmation.lines],
    ENTER_DURATION_MS + 120,
  );

  useEffect(() => {
    const timeoutIds = timeoutIdsRef.current;
    timeoutIds.push(
      window.setTimeout(() => {
        setPhase((current) => (current === "enter" ? "visible" : current));
      }, ENTER_DURATION_MS),
    );

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  function closeConfirmation() {
    if (phase === "exit") {
      return;
    }

    setPhase("exit");
    timeoutIdsRef.current.push(
      window.setTimeout(() => {
        setIsClosed(true);
        onClose?.();
      }, FADE_DURATION_MS),
    );
  }

  if (isClosed) {
    return null;
  }

  const titleToneClass =
    confirmation.titleTone === "green" ? "text-success" : "text-terminal-200";
  const hasTitle = Boolean(confirmation.title);
  const isEntering = phase === "enter";
  const isVisible = phase === "visible";
  const isExiting = phase === "exit";

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-50 flex justify-end p-4 sm:p-6 transition-opacity duration-300 ${isEntering || isVisible || isExiting ? "opacity-100" : "pointer-events-none opacity-0"}`}
    >
      <div
        className={`relative w-full max-w-md overflow-hidden rounded-2xl border border-terminal-400/30 bg-popover shadow-2xl shadow-terminal-950/40 transition-all duration-300 ${isEntering ? "animate-terminal-powerup origin-bottom-right" : isVisible ? "translate-y-0 scale-100 opacity-100" : isExiting ? "animate-terminal-powerdown origin-bottom-right" : "translate-y-4 scale-[0.985] opacity-0"}`}
      >
        {isEntering ? (
          <div className="terminal-scan-lines pointer-events-none absolute inset-0 animate-terminal-scanin opacity-70" />
        ) : null}
        {isExiting ? (
          <div className="terminal-scan-lines pointer-events-none absolute inset-0 animate-terminal-scanout opacity-70" />
        ) : null}
        <div
          className={`flex border-b border-terminal-400/20 bg-terminal-400/10 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.28em] ${hasTitle ? "items-center justify-between" : "justify-end"}`}
        >
          {hasTitle ? (
            <span className={titleToneClass}>{confirmation.title}</span>
          ) : null}
          <button
            aria-label="Close confirmation"
            className="text-terminal-300/70 transition-colors hover:text-terminal-200"
            type="button"
            onClick={closeConfirmation}
          >
            X
          </button>
        </div>
        <div
          className={`min-h-44 space-y-1 bg-surface/70 px-4 py-4 font-mono text-sm text-terminal-300 ${isEntering ? "animate-terminal-powerup-text" : isExiting ? "animate-terminal-powerdown-text" : ""}`}
        >
          {renderedLines.map((line, index) => (
            <div
              key={`${confirmation.command}-${index}`}
              className={`min-h-5 whitespace-pre-wrap break-words ${isStatusLine(line) ? "text-success" : ""}`}
            >
              {line}
              {activeLineIndex === index ? (
                <span
                  className={`ml-1 inline-block h-4 w-2 animate-pulse align-[-2px] ${isStatusLine(line) ? "bg-success" : "bg-terminal-300"}`}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TerminalConfirmationModal({
  confirmation,
  onClose,
}: TerminalConfirmationModalProps) {
  if (!confirmation) {
    return null;
  }

  const confirmationKey = [
    confirmation.title ?? "",
    confirmation.command,
    confirmation.titleTone ?? "",
    ...confirmation.lines,
  ].join("|");

  return (
    <TerminalConfirmationSurface
      key={confirmationKey}
      confirmation={confirmation}
      onClose={onClose}
    />
  );
}
