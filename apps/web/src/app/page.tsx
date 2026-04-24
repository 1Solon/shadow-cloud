import { getServerAuthSession } from "@/auth";
import { CampaignCard } from "@/components/campaign-card";
import { TerminalClock } from "@/components/terminal-clock";
import { UserBadge } from "@/components/user-badge";
import { SignOutButton } from "@/components/sign-out-button";
import { LoginButton } from "@/components/login-button";
import { listGames } from "@/lib/shadow-cloud-api";
import { formatTerminalClock } from "@/lib/terminal-clock";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Shadow Terminal",
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
  const [session, games] = await Promise.all([
    getServerAuthSession(),
    listGames(),
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

  return (
    <main className="h-screen overflow-hidden bg-black text-orange-400 font-mono p-4 flex flex-col">
      <div className="flex-1 min-h-0 w-full border border-orange-400 rounded-lg p-6 bg-black/90 shadow-2xl shadow-orange-400/20 flex flex-col overflow-hidden">
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
        <div className="mt-6 pt-4 border-t border-orange-400 flex justify-between text-xs text-orange-300/70">
          <div>STATUS: TERMINAL ACTIVE</div>
          <div>CAMPAIGNS: {games.length} MONITORED</div>
          <div>ENCRYPTION: QUANTUM-256</div>
        </div>
      </div>
    </main>
  );
}
