"use client";

import { Ascii } from "ascii.rest/react";
import { glitchTitlePiece } from "@/lib/glitch-title-piece";

const TITLE = "SHADOW-CLOUD";
const titlePiece = glitchTitlePiece(TITLE);

export function TerminalTitle({ className }: { className?: string }) {
  return (
    <Ascii
      piece={titlePiece}
      label={TITLE}
      className={`m-0 select-none overflow-hidden font-mono leading-none ${className ?? ""}`}
    />
  );
}
