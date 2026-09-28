import { useEffect, useState } from "react";

export function useTypedLines(lines: string[], startDelay: number) {
  const [renderedLines, setRenderedLines] = useState<string[]>([]);
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);
  const linesKey = JSON.stringify(lines);

  useEffect(() => {
    const allLines: string[] = JSON.parse(linesKey);
    const timeoutIds: number[] = [];
    let elapsed = startDelay;

    function schedule(callback: () => void) {
      timeoutIds.push(window.setTimeout(callback, elapsed));
    }

    allLines.forEach((line, lineIndex) => {
      for (let charIndex = 1; charIndex <= line.length; charIndex += 1) {
        const snapshot = [
          ...allLines.slice(0, lineIndex),
          line.slice(0, charIndex),
        ];

        schedule(() => {
          setRenderedLines(snapshot);
          setActiveLineIndex(lineIndex);
        });
        elapsed += lineIndex === 0 ? 18 : 12;
      }

      elapsed += 110;
    });

    schedule(() => {
      setRenderedLines(allLines);
      setActiveLineIndex(null);
    });

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [linesKey, startDelay]);

  return { renderedLines, activeLineIndex };
}
