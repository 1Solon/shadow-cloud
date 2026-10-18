import type { Metadata } from "next";
import { getServerAuthSession } from "@/auth";
import { AutoRefresh } from "@/components/auto-refresh";
import { BootSequence } from "@/components/boot-sequence";
import { CampaignList } from "@/components/campaign-list";
import { TerminalFrame } from "@/components/terminal-frame";
import { listGames } from "@/lib/shadow-cloud-api";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";

export async function generateMetadata(): Promise<Metadata> {
  const [session, games] = await Promise.all([
    getServerAuthSession(),
    listGames().catch(() => []),
  ]);
  const userId = session?.user?.id;
  const awaitingTurnCount = userId
    ? games.filter((game) => game.activePlayerUserId === userId).length
    : 0;

  return {
    title:
      awaitingTurnCount > 0
        ? `(${awaitingTurnCount}) Shadow-Cloud`
        : "Shadow-Cloud",
    description: "Current Shadow Cloud PBEM campaigns and turn status.",
  };
}

export default async function Home() {
  const [session, games, shadowOverrideEnabled] = await Promise.all([
    getServerAuthSession(),
    listGames(),
    getShadowOverrideEnabled(),
  ]);
  const userId = session?.user?.id;
  const yourCampaigns = userId
    ? games.filter((game) => game.participantUserIds.includes(userId))
    : [];
  const activeCampaigns = userId
    ? games.filter((game) => !game.participantUserIds.includes(userId))
    : games;

  return (
    <main className="min-h-dvh md:h-dvh md:overflow-hidden bg-background font-mono p-2 sm:p-4 flex flex-col text-terminal-400">
      <AutoRefresh />
      <BootSequence>
        <TerminalFrame
          user={session?.user}
          overrideEnabled={shadowOverrideEnabled}
        >
          <div className="min-h-0 flex-1 md:overflow-y-auto md:pr-2">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
              {session?.user ? (
                <CampaignList
                  campaigns={yourCampaigns}
                  title="YOUR CAMPAIGNS"
                  emptyTitle="No campaigns assigned to you"
                  emptyDescription="Join a Shadow Cloud campaign through Discord to see your active turns here."
                  currentUserId={userId}
                  hasExtendedControls
                />
              ) : null}
              <CampaignList
                campaigns={activeCampaigns}
                title="ACTIVE CAMPAIGNS"
                emptyTitle="No campaigns linked yet"
                emptyDescription={
                  <>
                    Run{" "}
                    <span className="font-mono text-terminal-400">/init</span>{" "}
                    or{" "}
                    <span className="font-mono text-terminal-400">
                      /register
                    </span>{" "}
                    inside a forum thread to join your first Shadow Cloud
                    Campaign.
                  </>
                }
                currentUserId={userId}
              />
            </div>
          </div>
        </TerminalFrame>
      </BootSequence>
    </main>
  );
}
