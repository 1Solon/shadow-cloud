"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut()}
      type="button"
      className="inline-flex h-8 items-center rounded-md border border-orange-400/60 bg-transparent px-3 text-xs font-mono uppercase tracking-[0.18em] text-orange-400/80 transition-colors hover:bg-orange-400 hover:text-black"
    >
      Disconnect
    </button>
  );
}
