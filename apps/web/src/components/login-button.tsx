"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function LoginButton() {
  return (
    <Button
      className="min-h-11 shrink-0 px-3 text-xs"
      type="button"
      variant="outline"
      onClick={() => signIn("discord")}
    >
      Sign in with Discord
    </Button>
  );
}
