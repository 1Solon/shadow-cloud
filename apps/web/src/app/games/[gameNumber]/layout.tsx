import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerAuthSession } from "@/auth";
import { TerminalClock } from "@/components/terminal-clock";
import { UserBadge } from "@/components/user-badge";
import { SignOutButton } from "@/components/sign-out-button";
import { LoginButton } from "@/components/login-button";
import { ShadowOverrideButton } from "@/components/shadow-override-button";
import { formatTerminalClock } from "@/lib/terminal-clock";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";
import { getGameDetail } from "@/lib/shadow-cloud-api";

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

  const shellTextClassName = shadowOverrideEnabled
    ? "text-red-400"
    : "text-orange-400";
  const shellFrameClassName = shadowOverrideEnabled
    ? "border-red-400 shadow-red-400/20"
    : "border-orange-400 shadow-orange-400/20";
  const shellHeaderClassName = shadowOverrideEnabled
    ? "border-red-400"
    : "border-orange-400";
  const shellLinkClassName = shadowOverrideEnabled
    ? "border-red-400 text-red-400 hover:bg-red-400"
    : "border-orange-400 text-orange-400 hover:bg-orange-400";
  const shellTitleClassName = shadowOverrideEnabled
    ? "text-red-300"
    : "text-orange-300";
  const shellStatusClassName = shadowOverrideEnabled
    ? "border-red-400 text-red-300/70"
    : "border-orange-400 text-orange-300/70";

  return (
    <main
      className={`h-screen overflow-hidden bg-black font-mono p-4 flex flex-col ${shellTextClassName}`}
    >
      <div
        className={`flex-1 min-h-0 flex flex-col rounded-lg border p-6 bg-black/90 shadow-2xl overflow-hidden ${shellFrameClassName}`}
      >
        {/* Terminal header bar */}
        <div
          className={`flex items-center justify-between border-b pb-4 mb-6 shrink-0 ${shellHeaderClassName}`}
        >
          <div className="flex items-center gap-4">
            <Link
              className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-mono transition-colors hover:text-black ${shellLinkClassName}`}
              href="/"
            >
              &lt; BACK
            </Link>
            <div className={`text-xl font-mono ${shellTitleClassName}`}>{`> ${game.gameNumber} : ${game.name}`}</div>
          </div>
          <div className="flex items-center gap-4">
            <UserBadge
              name={
                session?.user?.name ?? session?.user?.email ?? "Guest overlord"
              }
              image={session?.user?.image}
              isSignedIn={Boolean(session?.user)}
            />
            {session?.user ? <SignOutButton /> : <LoginButton />}
            {session?.user?.isShadowOverride ? (
              <ShadowOverrideButton enabled={shadowOverrideEnabled} />
            ) : null}
            <TerminalClock
              initialTime={formatTerminalClock(initialClockTime)}
            />
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-2">{children}</div>

        {/* Status bar */}
        <div
          className={`mt-auto pt-4 border-t flex justify-between text-xs text-orange-300/70 shrink-0 ${shellStatusClassName}`}
        >
          <div>STATUS: TERMINAL ACTIVE</div>
          <div>WORLD: {`#${game.gameNumber}`} MONITORED</div>
          <div>ENCRYPTION: QUANTUM-256</div>
        </div>
      </div>
    </main>
  );
}
