"use client";

import { Ascii } from "ascii.rest/react";
import { signIn } from "next-auth/react";
import { pixelTextPiece } from "@/lib/pixel-text-piece";
import { scrambleTagPiece } from "@/lib/scramble-tag-piece";

const signInPrompt = "Click here to sign in ->";
const promptPiece = scrambleTagPiece([signInPrompt]);
const guestPiece = pixelTextPiece(() => "GUEST", "GUEST");

export function GuestAccount() {
  return (
    <button
      type="button"
      aria-label="Sign in with Discord"
      onClick={() => signIn("discord")}
      className="group flex min-w-0 items-center gap-3 pr-[4ch] text-[4px] text-terminal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:text-[5px]"
    >
      <Ascii
        piece={promptPiece}
        label={signInPrompt}
        className="m-0 font-mono text-xs leading-none transition-colors group-hover:text-terminal-200"
      />
      <Ascii
        piece={guestPiece}
        label="Guest"
        className="m-0 select-none overflow-hidden font-mono leading-none transition-colors group-hover:text-terminal-200"
      />
    </button>
  );
}
