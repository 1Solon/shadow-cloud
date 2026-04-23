import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerAuthSession } from "@/auth";
import { TerminalClock } from "@/components/terminal-clock";
import { UserBadge } from "@/components/user-badge";
import { SignOutButton } from "@/components/sign-out-button";
import { LoginButton } from "@/components/login-button";
import { formatTerminalClock } from "@/lib/terminal-clock";
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
  const [session, game] = await Promise.all([
    getServerAuthSession(),
    getGameDetail(gameNumber),
  ]);
  const initialClockTime = new Date();

  if (!game) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-black text-orange-400 font-mono p-4">
      <div className="min-h-[calc(100vh-2rem)] flex flex-col border border-orange-400 rounded-lg p-6 bg-black/90 shadow-2xl shadow-orange-400/20">
        {/* Terminal header bar */}
        <div className="flex items-center justify-between border-b border-orange-400 pb-4 mb-6 shrink-0">
          <div className="flex items-center gap-4">
            <Link
              className="inline-flex h-9 items-center rounded-md border border-orange-400 px-3 text-sm font-mono text-orange-400 transition-colors hover:bg-orange-400 hover:text-black"
              href="/"
            >
              &lt; BACK
            </Link>
            <div className="text-orange-300 text-xl font-mono">{`> ${game.name}`}</div>
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
            <TerminalClock
              initialTime={formatTerminalClock(initialClockTime)}
            />
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1">{children}</div>

        {/* Status bar */}
        <div className="mt-auto pt-4 border-t border-orange-400 flex justify-between text-xs text-orange-300/70 shrink-0">
          <div>STATUS: TERMINAL ACTIVE</div>
          <div>WORLD: {`#${game.gameNumber}`} MONITORED</div>
          <div>ENCRYPTION: QUANTUM-256</div>
        </div>
      </div>
    </main>
  );
}
