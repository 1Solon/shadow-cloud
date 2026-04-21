"use client";

import { signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SessionControlsProps = {
  isSignedIn: boolean;
  identityLabel: string;
};

export function SessionControls({
  isSignedIn,
  identityLabel,
}: SessionControlsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isSignedIn
            ? `Connected as ${identityLabel}`
            : "Sign in with Discord"}
        </CardTitle>
        <CardDescription>
          {isSignedIn
            ? "Use your Discord identity to access overlord actions, upload turns, and manage recoveries as the app expands."
            : "Sign in to connect your Discord identity to Shadow Cloud and unlock lord-specific actions."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row">
        {isSignedIn ? (
          <Button onClick={() => signOut()} size="lg" type="button">
            Sign out
          </Button>
        ) : (
          <Button onClick={() => signIn("discord")} size="lg" type="button">
            Sign in with Discord
          </Button>
        )}
        <Button size="lg" type="button" variant="outline" disabled>
          Game detail pages next
        </Button>
      </CardContent>
    </Card>
  );
}
