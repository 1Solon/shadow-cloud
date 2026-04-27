import { getServerAuthSession } from "@/auth";
import { CampaignCard } from "@/components/campaign-card";
import { TerminalClock } from "@/components/terminal-clock";
import { UserBadge } from "@/components/user-badge";
import { SignOutButton } from "@/components/sign-out-button";
import { LoginButton } from "@/components/login-button";
import { ShadowOverrideButton } from "@/components/shadow-override-button";
import { listGames } from "@/lib/shadow-cloud-api";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";
import { formatTerminalClock } from "@/lib/terminal-clock";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Shadow-Cloud",
  description: "Current Shadow Cloud PBEM campaigns and turn status.",
};

function CampaignList({
  campaigns,
  title,
  emptyTitle,
  emptyDescription,
  currentUserId,
}: {
  campaigns: Awaited<ReturnType<typeof listGames>>;
  title: string;
  emptyTitle: string;
  emptyDescription: React.ReactNode;
  currentUserId?: string;
}) {
  return (
    <section className="space-y-4">
      <div className="text-orange-300 text-lg font-mono">{`> ${title} (${campaigns.length})`}</div>
      <div className="flex flex-col gap-3">
        {campaigns.length === 0 ? (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardHeader>
              <CardTitle>{emptyTitle}</CardTitle>
              <CardDescription>{emptyDescription}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          campaigns.map((game) => (
            <CampaignCard
              key={game.id}
              currentUserId={currentUserId}
              game={game}
            />
          ))
        )}
      </div>
    </section>
  );
}

export default async function Home() {
  const [session, games, shadowOverrideEnabled] = await Promise.all([
    getServerAuthSession(),
    listGames(),
    getShadowOverrideEnabled(),
  ]);
  const initialClockTime = new Date();
  const userId = session?.user?.id;
  const yourCampaigns = userId
    ? games
        .filter((game) => game.participantUserIds.includes(userId))
        .sort((leftGame, rightGame) => {
          const leftIsUsersTurn = leftGame.activePlayerUserId === userId;
          const rightIsUsersTurn = rightGame.activePlayerUserId === userId;

          if (leftIsUsersTurn === rightIsUsersTurn) {
            return 0;
          }

          return leftIsUsersTurn ? -1 : 1;
        })
    : [];
  const activeCampaigns = userId
    ? games.filter((game) => !game.participantUserIds.includes(userId))
    : games;

  const signedInIdentity =
    session?.user?.name ?? session?.user?.email ?? "Guest lord";
  const shellTextClassName = shadowOverrideEnabled
    ? "text-red-400"
    : "text-orange-400";
  const shellFrameClassName = shadowOverrideEnabled
    ? "border-red-400 shadow-red-400/20"
    : "border-orange-400 shadow-orange-400/20";
  const shellHeaderClassName = shadowOverrideEnabled
    ? "border-red-400"
    : "border-orange-400";
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
        className={`flex-1 min-h-0 w-full rounded-lg border p-6 bg-black/90 shadow-2xl flex flex-col overflow-hidden ${shellFrameClassName}`}
      >
        {/* Terminal header bar */}
        <div
          className={`flex items-center justify-between border-b pb-4 mb-6 ${shellHeaderClassName}`}
        >
          <div className={`terminal-title-effect text-xl font-mono ${shellTitleClassName}`}>
            <span>{`> SHADOW-CLOUD`}</span>
            <span aria-hidden="true" className="terminal-title-cursor" />
          </div>
          <div className="flex items-center gap-6">
            <UserBadge
              name={signedInIdentity}
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

        <div className="flex flex-col gap-8 flex-1 min-h-0 overflow-y-auto pr-2">
          {session?.user ? (
            <CampaignList
              campaigns={yourCampaigns}
              title="YOUR CAMPAIGNS"
              emptyTitle="No campaigns assigned to you"
              emptyDescription="Join a Shadow Cloud campaign through Discord to see your active turns here."
              currentUserId={userId}
            />
          ) : null}
          <CampaignList
            campaigns={activeCampaigns}
            title="ACTIVE CAMPAIGNS"
            emptyTitle="No campaigns linked yet"
            emptyDescription={
              <>
                Run <span className="font-mono text-orange-400">/init</span>{" "}
                inside a Discord forum thread to create the first Shadow Cloud
                campaign record.
              </>
            }
            currentUserId={userId}
          />
        </div>
        {/* Status bar */}
        <div
          className={`mt-6 pt-4 border-t flex justify-between text-xs ${shellStatusClassName}`}
        >
          <div>STATUS: TERMINAL ACTIVE</div>
          <div>CAMPAIGNS: {games.length} MONITORED</div>
          <div>ENCRYPTION: QUANTUM-256</div>
        </div>
      </div>
    </main>
  );
}
