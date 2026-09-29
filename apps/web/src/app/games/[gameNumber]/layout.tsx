import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerAuthSession } from "@/auth";
import { AccountMenu } from "@/components/account-menu";
import { TerminalClock } from "@/components/terminal-clock";
import { Button } from "@/components/ui/button";
import { UserBadge } from "@/components/user-badge";
import { LoginButton } from "@/components/login-button";
import { formatTerminalClock } from "@/lib/terminal-clock";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";
import { getGameDetail } from "@/lib/shadow-cloud-api";
import { componentVersionStatus } from "@/lib/component-versions";

type GameLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ gameNumber: string }>;
};

export default async function GameLayout({
  children,
  params,
}: GameLayoutProps) {
  const { gameNumber } = await params;
  const [session, game, shadowOverrideEnabled] = await Promise.all([
    getServerAuthSession(),
    getGameDetail(gameNumber),
    getShadowOverrideEnabled(),
  ]);
  const initialClockTime = new Date();

  if (!game) {
    notFound();
  }

  return (
    <main className="min-h-dvh md:h-dvh md:overflow-hidden bg-background font-mono p-2 sm:p-4 flex flex-col text-terminal-400">
      <div className="flex-1 min-h-0 flex flex-col rounded-lg border p-3 sm:p-6 bg-card shadow-2xl md:overflow-hidden border-terminal-400 shadow-terminal-400/20">
        {/* Terminal header bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 mb-4 shrink-0 border-terminal-400">
          <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-0 sm:gap-4">
            <Button asChild className="h-11 shrink-0 px-3" variant="outline">
              <Link href="/">&lt; BACK</Link>
            </Button>
            <div className="min-w-0 break-words text-base sm:text-xl font-mono text-terminal-300">{`> ${game.gameNumber} : ${game.name}`}</div>
          </div>
          <div className="flex w-full max-w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-4">
            {session?.user ? (
              <AccountMenu
                name={
                  session.user.name ?? session.user.email ?? "Guest overlord"
                }
                image={session.user.image}
                canOverride={Boolean(session.user.isShadowOverride)}
                overrideEnabled={shadowOverrideEnabled}
              />
            ) : (
              <>
                <div className="hidden sm:block">
                  <UserBadge
                    name="Guest overlord"
                    image={null}
                    isSignedIn={false}
                  />
                </div>
                <LoginButton />
              </>
            )}
            <div className="hidden xl:block">
              <TerminalClock
                initialTime={formatTerminalClock(initialClockTime)}
              />
            </div>
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 min-h-0 md:overflow-y-auto md:pr-2">
          {children}
        </div>

        {/* Status bar */}
        <div className="mt-4 pt-3 border-t flex flex-wrap justify-between gap-2 text-xs shrink-0 border-terminal-400 text-terminal-300/70">
          <div>{componentVersionStatus}</div>
          <div>CAMPAIGN: {`#${game.gameNumber}`}</div>
        </div>
      </div>
    </main>
  );
}
