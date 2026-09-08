"use client";

import { signIn } from "next-auth/react";

export function LoginButton() {
  return (
    <button
      onClick={() => signIn("discord")}
      type="button"
      className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-orange-400/60 bg-transparent px-3 text-xs font-mono text-orange-200 transition-colors hover:bg-orange-400 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Sign in with Discord
    </button>
  );
}
