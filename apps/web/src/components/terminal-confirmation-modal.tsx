"use client";

import { useEffect, useRef, useState } from "react";

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

function TerminalConfirmationSurface({
  confirmation,
  onClose,
}: TerminalConfirmationSurfaceProps) {
  const [phase, setPhase] = useState<TerminalPhase>("enter");
  const [renderedLines, setRenderedLines] = useState<string[]>([]);
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);
  const [isClosed, setIsClosed] = useState(false);
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

  function closeConfirmation() {
    if (phase === "exit") {
      return;
    }

    clearScheduledTimeouts();
    setPhase("exit");

    scheduleTimeout(() => {
      setIsClosed(true);
      setRenderedLines([]);
      setActiveLineIndex(null);
      onClose?.();
    }, FADE_DURATION_MS);
  }

  useEffect(
    () => () => {
      clearScheduledTimeouts();
    },
    [],
  );

  useEffect(() => {
    const terminalLines = [`> ${confirmation.command}`, ...confirmation.lines];
    let elapsed = ENTER_DURATION_MS + 120;

    clearScheduledTimeouts();

    scheduleTimeout(() => {
      setPhase("visible");
    }, ENTER_DURATION_MS);

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
  }, [confirmation, onClose]);

  if (isClosed) {
    return null;
  }

  const titleToneClass =
    confirmation.titleTone === "green" ? "text-green-200" : "text-orange-200";
  const hasTitle = Boolean(confirmation.title);
  const isEntering = phase === "enter";
  const isVisible = phase === "visible";
  const isExiting = phase === "exit";

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-50 flex justify-end p-4 sm:p-6 transition-opacity duration-300 ${isEntering || isVisible || isExiting ? "opacity-100" : "pointer-events-none opacity-0"}`}
    >
      <div
        className={`relative w-full max-w-md overflow-hidden rounded-2xl border border-orange-400/30 bg-[#0a0711] shadow-2xl shadow-orange-950/40 transition-all duration-300 ${isEntering ? "animate-terminal-powerup origin-bottom-right" : isVisible ? "translate-y-0 scale-100 opacity-100" : isExiting ? "animate-terminal-powerdown origin-bottom-right" : "translate-y-4 scale-[0.985] opacity-0"}`}
      >
        {isEntering ? (
          <div className="pointer-events-none absolute inset-0 animate-terminal-scanin bg-[repeating-linear-gradient(180deg,rgba(251,146,60,0.12)_0px,rgba(251,146,60,0.12)_1px,transparent_1px,transparent_4px)] opacity-70" />
        ) : null}
        {isExiting ? (
          <div className="pointer-events-none absolute inset-0 animate-terminal-scanout bg-[repeating-linear-gradient(180deg,rgba(251,146,60,0.12)_0px,rgba(251,146,60,0.12)_1px,transparent_1px,transparent_4px)] opacity-70" />
        ) : null}
        <div
          className={`flex border-b border-orange-400/20 bg-orange-400/10 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.28em] ${hasTitle ? "items-center justify-between" : "justify-end"}`}
        >
          {hasTitle ? (
            <span className={titleToneClass}>{confirmation.title}</span>
          ) : null}
          <button
            aria-label="Close confirmation"
            className="text-orange-300/70 transition-colors hover:text-orange-200"
            type="button"
            onClick={closeConfirmation}
          >
            X
          </button>
        </div>
        <div
          className={`min-h-44 space-y-1 bg-black/70 px-4 py-4 font-mono text-sm text-orange-300 ${isEntering ? "animate-terminal-powerup-text" : isExiting ? "animate-terminal-powerdown-text" : ""}`}
        >
          {renderedLines.map((line, index) => (
            <div
              key={`${confirmation.command}-${index}`}
              className={`min-h-5 whitespace-pre-wrap break-words ${line.startsWith("<") && line.endsWith(">") ? "text-green-300" : ""}`}
            >
              {line}
              {activeLineIndex === index ? (
                <span
                  className={`ml-1 inline-block h-4 w-2 animate-pulse align-[-2px] ${line.startsWith("<") && line.endsWith(">") ? "bg-green-300" : "bg-orange-300"}`}
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
