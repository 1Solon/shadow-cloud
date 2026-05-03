import { useEffect, useRef, useState } from "react";

const enterDurationMs = 260;
const exitDurationMs = 260;
const textEnterDelayMs = enterDurationMs + 120;

const helpLines = [
  "Setup:",
  "  1. Select your save directory.",
  "     Windows default:",
  "C:\\Users\\{you}\\Documents\\My Games\\Shadow Empire",
  "  2. Let Shadow Cloud create folders for active games.",
  "",
  "How Shadow Cloud local works:",
  "  - Each game uses one folder for incoming and outgoing .se1 files.",
  "  - Game folder changes and scans occur only when sync is triggered.",
  "  - Your turn: the newest .se1 file added after your turn started is uploaded.",
  "  - Not your turn: all file changes are ignored.",
  "  - You do not need a special file name.",
  "  - Other players' turns download into the same game folder.",
  "",
  "Playing a turn:",
  "  1. Open the game folder.",
  "  2. Load the previous player's latest turn file.",
  "  3. Save your finished turn back into that same game folder.",
  "  4. Use Sync now, or leave the timer active.",
  "",
  "   You can reopen this page with the Help button in the header.",
];

type TerminalPhase = "enter" | "visible" | "exit";

type DesktopHelpModalProps = {
  onClose: () => void;
};

export function DesktopHelpModal({ onClose }: DesktopHelpModalProps) {
  const [phase, setPhase] = useState<TerminalPhase>("enter");
  const [renderedLines, setRenderedLines] = useState<string[]>([]);
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);
  const [isClosed, setIsClosed] = useState(false);
  const timeoutIdsRef = useRef<number[]>([]);

  function clearScheduledTimeouts() {
    timeoutIdsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    timeoutIdsRef.current = [];
  }

  function scheduleTimeout(callback: () => void, delay: number) {
    const timeoutId = window.setTimeout(callback, delay);
    timeoutIdsRef.current.push(timeoutId);
  }

  function closeHelp() {
    if (phase === "exit") {
      return;
    }

    clearScheduledTimeouts();
    setPhase("exit");

    scheduleTimeout(() => {
      setIsClosed(true);
      setRenderedLines([]);
      setActiveLineIndex(null);
      onClose();
    }, exitDurationMs);
  }

  useEffect(
    () => () => {
      clearScheduledTimeouts();
    },
    [],
  );

  useEffect(() => {
    const terminalLines = ["> help --shadow-cloud-local", ...helpLines];
    let elapsed = textEnterDelayMs;

    clearScheduledTimeouts();

    scheduleTimeout(() => {
      setPhase("visible");
    }, enterDurationMs);

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
        elapsed += lineIndex === 0 ? 9 : 3.5;
      }

      elapsed += 40;
    });

    scheduleTimeout(() => {
      setRenderedLines(terminalLines);
      setActiveLineIndex(null);
    }, elapsed);

    return () => {
      clearScheduledTimeouts();
    };
  }, []);

  if (isClosed) {
    return null;
  }

  function getLineClassName(line: string, index: number) {
    const classNames = ['desktop-help-line'];

    if (index === 0) {
      classNames.push('desktop-help-command');
    } else if (line.endsWith(':')) {
      classNames.push('desktop-help-section-line');
    } else if (line.trim().startsWith('-') || /^\s+\d+\./.test(line)) {
      classNames.push('desktop-help-list-line');
    } else if (line.includes('C:\\')) {
      classNames.push('desktop-help-path-line');
    } else if (line === '') {
      classNames.push('desktop-help-spacer-line');
    }

    return classNames.join(' ');
  }

  return (
    <div className="desktop-help-overlay" onClick={closeHelp}>
      <div
        className={`desktop-help-modal desktop-help-modal-${phase}`}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {phase === "enter" ? <div className="desktop-help-scanin" /> : null}
        {phase === "exit" ? <div className="desktop-help-scanout" /> : null}
        <header className="desktop-help-header">
          <span>{"> HELP"}</span>
          <button
            aria-label="Close help"
            className="desktop-help-close"
            type="button"
            onClick={closeHelp}
          >
            X
          </button>
        </header>
        <section
          aria-label="Shadow Cloud local help"
          className={`desktop-help-body ${
            phase === "enter"
              ? "desktop-help-body-enter"
              : phase === "exit"
                ? "desktop-help-body-exit"
                : ""
          }`}
        >
          {renderedLines.map((line, index) => (
            <div
              className={getLineClassName(line, index)}
              key={`desktop-help-${index}`}
            >
              {line}
              {activeLineIndex === index ? (
                <span aria-hidden="true" className="desktop-help-caret" />
              ) : null}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
