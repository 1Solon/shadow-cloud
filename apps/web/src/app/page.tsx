import Link from "next/link";
import { getServerAuthSession } from "@/auth";
import { TerminalClock } from "@/components/terminal-clock";
import { UserBadge } from "@/components/user-badge";
import { SignOutButton } from "@/components/sign-out-button";
import { LoginButton } from "@/components/login-button";
import { listGames } from "@/lib/shadow-cloud-api";
import { formatTerminalClock } from "@/lib/terminal-clock";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Shadow Terminal",
  description: "Current Shadow Cloud PBEM games and turn status.",
};

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export default async function Home() {
  const [session, games] = await Promise.all([
    getServerAuthSession(),
    listGames(),
  ]);
  const initialClockTime = new Date();

  const signedInIdentity =
    session?.user?.name ?? session?.user?.email ?? "Guest lord";

  return (
    <main className="min-h-screen bg-black text-orange-400 font-mono p-4 flex flex-col">
      <div className="flex-1 w-full border border-orange-400 rounded-lg p-6 bg-black/90 shadow-2xl shadow-orange-400/20 flex flex-col">
        {/* Terminal header bar */}
        <div className="flex items-center justify-between border-b border-orange-400 pb-4 mb-6">
          <div className="text-orange-300 text-xl font-mono">{`> SHADOW CLOUD TERMINAL`}</div>
          <div className="flex items-center gap-6">
            <UserBadge
              name={signedInIdentity}
              image={session?.user?.image}
              isSignedIn={Boolean(session?.user)}
            />
            {session?.user ? <SignOutButton /> : <LoginButton />}
            <TerminalClock
              initialTime={formatTerminalClock(initialClockTime)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-8 flex-1">
          <section className="space-y-4">
            <div className="text-orange-300 text-lg font-mono">{`> ACTIVE WORLDS (${games.length})`}</div>
            <div className="flex flex-col gap-3">
              {games.length === 0 ? (
                <Card className="md:col-span-2 xl:col-span-3">
                  <CardHeader>
                    <CardTitle>No games linked yet</CardTitle>
                    <CardDescription>
                      Run{" "}
                      <span className="font-mono text-orange-400">/init</span>{" "}
                      inside a Discord forum thread to create the first Shadow
                      Cloud game record.
                    </CardDescription>
                  </CardHeader>
                </Card>
              ) : (
                games.map((game) => {
                  return (
                    <Card
                      key={game.id}
                      className="bg-black/50 border-orange-400"
                    >
                      <CardContent className="grid grid-cols-3 items-stretch gap-6 pt-6">
                        {/* Left: identity */}
                        <div className="flex flex-col gap-1 border-r border-orange-400/20 pr-6">
                          <div className="text-lg font-semibold text-orange-300">
                            {`${game.gameNumber} : ${game.name}`}
                          </div>
                          <div className="text-xs text-orange-300/60">
                            Overlord {game.organizerDisplayName}
                          </div>
                          <div className="text-xs uppercase tracking-[0.18em] text-orange-300/50 mt-1">
                            Turn {game.roundNumber}
                          </div>
                          <div className="text-xs uppercase tracking-[0.18em] text-orange-300/40 mt-1">
                            Updated {formatTimestamp(game.updatedAt)}
                          </div>
                        </div>

                        {/* Middle: stats */}
                        <div className="flex flex-col gap-1 border-r border-orange-400/20 pl-6 pr-6">
                          <div className="flex items-center gap-4 px-1 py-1">
                            <div className="w-32 shrink-0 text-xs uppercase tracking-[0.2em] text-orange-300/70">
                              Active lord
                            </div>
                            <div className="text-sm font-medium text-orange-300">
                              {game.activePlayerDisplayName}
                            </div>
                          </div>
                          <div className="flex items-center gap-4 px-1 py-1">
                            <div className="w-32 shrink-0 text-xs uppercase tracking-[0.2em] text-orange-300/70">
                              Overlord
                            </div>
                            <div className="text-sm font-medium text-orange-300">
                              {game.organizerDisplayName}
                            </div>
                          </div>
                          <div className="flex items-center gap-4 px-1 py-1">
                            <div className="w-32 shrink-0 text-xs uppercase tracking-[0.2em] text-orange-300/70">
                              Seats
                            </div>
                            <div className="text-sm font-medium text-orange-300">
                              {`${game.filledSeatCount} / ${game.playerCount}`}
                            </div>
                          </div>
                        </div>

                        {/* Right: open button */}
                        <div className="pl-6 h-full">
                          <Link
                            className="flex h-full w-full items-center justify-center rounded-md border border-orange-400 px-4 text-sm font-mono font-medium uppercase tracking-[0.18em] text-orange-400 transition-colors hover:bg-orange-400 hover:text-black"
                            href={`/games/${game.gameNumber}`}
                          >
                            Open
                          </Link>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </section>
        </div>
        {/* Status bar */}
        <div className="mt-6 pt-4 border-t border-orange-400 flex justify-between text-xs text-orange-300/70">
          <div>STATUS: TERMINAL ACTIVE</div>
          <div>WORLDS: {games.length} MONITORED</div>
          <div>ENCRYPTION: QUANTUM-256</div>
        </div>
      </div>
    </main>
  );
}
