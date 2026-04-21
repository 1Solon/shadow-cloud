"use client";

import { useEffect, useState } from "react";
import { formatTerminalClock } from "@/lib/terminal-clock";

type TerminalClockProps = {
  initialTime: string;
};

export function TerminalClock({ initialTime }: TerminalClockProps) {
  const [time, setTime] = useState(initialTime);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const timeoutId = setTimeout(() => {
      setTime(formatTerminalClock(new Date()));
      intervalId = setInterval(() => {
        setTime(formatTerminalClock(new Date()));
      }, 1000);
    }, 1000);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  return (
    <span className="text-orange-300 text-sm font-mono tabular-nums">
      {time}
    </span>
  );
}
