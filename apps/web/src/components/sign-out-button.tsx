"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button
      className="uppercase tracking-[0.18em]"
      size="sm"
      type="button"
      variant="outline"
      onClick={() => signOut()}
    >
      Disconnect
    </Button>
  );
}
