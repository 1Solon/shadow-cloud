"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const pillars = [
  "Forum threads map one-to-one with active PBEM games.",
  "Overlords define seat order in the web app and can recover by reassigning the active lord.",
  "Only the active lord uploads; other participants can still access history in a lower-emphasis panel.",
];

export function AuthCta() {
  const { data: session } = useSession();
  const primaryIdentity =
    session?.user?.name ?? session?.user?.email ?? "Overlord";

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="gap-4">
          <span className="w-fit rounded-full border border-orange-400/30 bg-orange-400/10 px-3 py-1 text-xs uppercase tracking-[0.28em] text-orange-300 font-mono">
            Shadow Cloud
          </span>
          <CardTitle className="max-w-2xl text-4xl leading-tight sm:text-5xl">
            PBEM turn logistics for Shadow Empire, without the email chain.
          </CardTitle>
          <CardDescription className="max-w-2xl text-base leading-7 sm:text-lg">
            This first implementation slice now includes Discord sign-in
            scaffolding in the web app alongside the monorepo, shared turn-order
            rules, Prisma schema, Nest API surface, and Discord bot shell.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row">
          {session ? (
            <>
              <Button onClick={() => signOut()} size="lg" type="button">
                Sign out
              </Button>
              <Button size="lg" variant="outline">
                Connect Discord Forum
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => signIn("discord")} size="lg" type="button">
                Sign in with Discord
              </Button>
              <Button size="lg" variant="outline">
                Connect Discord Forum
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {session
              ? `Connected as ${primaryIdentity}`
              : "Initial vertical slice"}
          </CardTitle>
          <CardDescription>
            {session
              ? "The landing page is now reading session state through the NextAuth client."
              : "The project now has real app shells instead of placeholder folders."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            {pillars.map((pillar) => (
              <li
                key={pillar}
                className="rounded-lg border border-orange-400/20 bg-orange-400/5 px-4 py-3 text-orange-300 font-mono"
              >
                {pillar}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
