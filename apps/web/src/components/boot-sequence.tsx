"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Ascii } from "ascii.rest/react";
import * as bootLog from "ascii.rest/pieces/boot-log";
import { TerminalTitle } from "@/components/terminal-title";
import { bootedSessionKey } from "@/lib/boot-session";

const artClass = "m-0 select-none overflow-hidden font-mono leading-none";

const crtStyles = `
@keyframes crt-collapse {
  0% { transform: scale(1, 1); filter: brightness(1); opacity: 1; }
  50% { transform: scale(1, 0.006); filter: brightness(3); opacity: 1; }
  80% { transform: scale(0.12, 0.006); filter: brightness(5); opacity: 1; }
  100% { transform: scale(0, 0); filter: brightness(5); opacity: 0; }
}
@keyframes crt-dot {
  0%, 70% { opacity: 0; transform: scale(1); }
  78% { opacity: 1; transform: scale(1.6); }
  100% { opacity: 0; transform: scale(0.4); }
}
@keyframes crt-warmup {
  0% { transform: scale(0.02, 0.004); filter: brightness(5) blur(1px); }
  12% { transform: scale(1, 0.004); filter: brightness(5) blur(1px); }
  40% { transform: scale(1, 1.02); filter: brightness(2.2) blur(0.5px); }
  50% { transform: scale(1, 1); filter: brightness(0.6); }
  58% { filter: brightness(1.5); }
  66% { filter: brightness(0.85); }
  74% { filter: brightness(1.2); }
  100% { transform: scale(1, 1); filter: brightness(1) blur(0); }
}
@keyframes crt-flash {
  0%, 10% { opacity: 0; }
  38% { opacity: 0.18; }
  100% { opacity: 0; }
}
@keyframes crt-roll {
  0% { transform: translateY(-100%); opacity: 0; }
  35% { opacity: 1; }
  100% { transform: translateY(700%); opacity: 0; }
}
`;

type BootPhase = "boot" | "off" | "on" | "done";

function readSkipBoot() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return true;
  }
  try {
    return sessionStorage.getItem(bootedSessionKey) !== null;
  } catch {
    return false;
  }
}

function markBooted() {
  try {
    sessionStorage.setItem(bootedSessionKey, "1");
  } catch {}
}

function subscribeToNothing() {
  return () => {};
}

export function BootSequence({ children }: { children: ReactNode }) {
  const [bootPhase, setPhase] = useState<BootPhase>("boot");
  const skipBoot = useSyncExternalStore(
    subscribeToNothing,
    readSkipBoot,
    () => false,
  );
  const phase = skipBoot && bootPhase === "boot" ? "done" : bootPhase;

  useEffect(() => {
    if (phase === "boot") {
      const end = () => {
        markBooted();
        setPhase("off");
      };
      const timeout = window.setTimeout(end, 5500);
      window.addEventListener("keydown", end);
      return () => {
        window.clearTimeout(timeout);
        window.removeEventListener("keydown", end);
      };
    }
    if (phase === "off") {
      const timeout = window.setTimeout(() => setPhase("on"), 750);
      return () => window.clearTimeout(timeout);
    }
    if (phase === "on") {
      const timeout = window.setTimeout(() => setPhase("done"), 1300);
      return () => window.clearTimeout(timeout);
    }
  }, [phase]);

  return (
    <>
      <style>{crtStyles}</style>
      {phase === "boot" || phase === "off" ? (
        <BootSplash
          collapsing={phase === "off"}
          onSkip={() => {
            markBooted();
            setPhase("off");
          }}
        />
      ) : null}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        style={
          phase === "on"
            ? {
                animation:
                  "crt-warmup 1200ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
              }
            : undefined
        }
      >
        {children}
        {phase === "on" ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-lg"
          >
            <div
              className="absolute inset-0 bg-terminal-50"
              style={{ animation: "crt-flash 1200ms ease-out both" }}
            />
            <div
              className="absolute inset-x-0 top-0 h-[15%]"
              style={{
                background:
                  "linear-gradient(to bottom, transparent, color-mix(in oklab, var(--terminal-300) 30%, transparent), transparent)",
                animation: "crt-roll 1100ms 250ms ease-in both",
              }}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function BootSplash({
  collapsing,
  onSkip,
}: {
  collapsing: boolean;
  onSkip: () => void;
}) {
  return (
    <button
      type="button"
      data-boot-splash=""
      onClick={collapsing ? undefined : onSkip}
      className="fixed inset-0 z-40 flex cursor-pointer items-center justify-center overflow-hidden bg-background font-mono text-terminal-400"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -ml-1 -mt-1 size-2 rounded-full bg-terminal-50 shadow-[0_0_24px_8px_var(--terminal-300)]"
        style={{
          opacity: 0,
          animation: collapsing ? "crt-dot 700ms ease-out both" : undefined,
        }}
      />
      <div
        className="flex h-[65dvh] w-[65vw] flex-col rounded-lg border border-terminal-400 bg-card p-3 text-left shadow-2xl shadow-terminal-400/20 sm:p-6"
        style={
          collapsing
            ? {
                animation:
                  "crt-collapse 450ms cubic-bezier(0.6, 0, 0.8, 0.4) both",
              }
            : undefined
        }
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3 border-b border-terminal-400 pb-3">
          <TerminalTitle className="text-[4px] text-terminal-300 sm:text-[5px]" />
        </div>
        <div
          className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          style={{ containerType: "size" }}
        >
          <Ascii
            piece={bootLog}
            label="Shadow Cloud booting"
            className={`${artClass} text-terminal-300`}
            style={{
              fontSize: "min(calc(100cqw / 38.4), calc(100cqh / 16))",
              lineHeight: "calc(100cqh / 16)",
            }}
          />
        </div>
        <div className="mt-4 flex shrink-0 items-center justify-between gap-2 border-t border-terminal-400 pt-3 text-xs text-terminal-300/70">
          <span className="animate-pulse">PRESS ANY KEY TO SKIP</span>
        </div>
      </div>
    </button>
  );
}
