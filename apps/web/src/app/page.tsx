import { getServerAuthSession } from "@/auth";
import { CampaignList } from "@/components/campaign-list";
import { TerminalClock } from "@/components/terminal-clock";
import { UserBadge } from "@/components/user-badge";
import { SignOutButton } from "@/components/sign-out-button";
import { LoginButton } from "@/components/login-button";
import { ShadowOverrideButton } from "@/components/shadow-override-button";
import { listGames } from "@/lib/shadow-cloud-api";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";
import { formatTerminalClock } from "@/lib/terminal-clock";
import { componentVersionStatus } from "@/lib/component-versions";
export const metadata = {
  title: "Shadow-Cloud",
  description: "Current Shadow Cloud PBEM campaigns and turn status.",
};

export default async function Home() {
  const [session, games, shadowOverrideEnabled] = await Promise.all([
    getServerAuthSession(),
    listGames(),
    getShadowOverrideEnabled(),
  ]);
  const initialClockTime = new Date();
  const userId = session?.user?.id;
  const yourCampaigns = userId
    ? games.filter((game) => game.participantUserIds.includes(userId))
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
      className={`min-h-dvh md:h-dvh md:overflow-hidden bg-black font-mono p-2 sm:p-4 flex flex-col ${shellTextClassName}`}
    >
      <div
        className={`flex-1 min-h-0 w-full rounded-lg border p-3 sm:p-6 bg-black/90 shadow-2xl flex flex-col md:overflow-hidden ${shellFrameClassName}`}
      >
        {/* Terminal header bar */}
        <div
          className={`flex flex-wrap items-center justify-between gap-3 border-b pb-3 mb-4 shrink-0 ${shellHeaderClassName}`}
        >
          <div
            className={`terminal-title-effect whitespace-nowrap text-base sm:text-xl font-mono ${shellTitleClassName}`}
          >
            <span>{`> SHADOW-CLOUD`}</span>
            <span aria-hidden="true" className="terminal-title-cursor" />
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-3">
            <div className={session?.user ? "min-w-0" : "hidden sm:block"}>
              <UserBadge
                name={signedInIdentity}
                image={session?.user?.image}
                isSignedIn={Boolean(session?.user)}
              />
            </div>
            {session?.user ? <SignOutButton /> : <LoginButton />}
            {session?.user?.isShadowOverride ? (
              <ShadowOverrideButton enabled={shadowOverrideEnabled} />
            ) : null}
            <div className="hidden xl:block">
              <TerminalClock
                initialTime={formatTerminalClock(initialClockTime)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 flex-1 min-h-0 md:overflow-y-auto md:pr-2">
          {session?.user ? (
            <CampaignList
              campaigns={yourCampaigns}
              title="YOUR CAMPAIGNS"
              emptyTitle="No campaigns assigned to you"
              emptyDescription="Join a Shadow Cloud campaign through Discord to see your active turns here."
              currentUserId={userId}
              hasSortingOptions
            />
          ) : null}
          <CampaignList
            campaigns={activeCampaigns}
            title="ACTIVE CAMPAIGNS"
            emptyTitle="No campaigns linked yet"
            emptyDescription={
              <>
                Run <span className="font-mono text-orange-400">/init</span>{" "}
                or <span className="font-mono text-orange-400">/register</span>{" "}
                inside a forum thread to join your first Shadow Cloud Campaign.
              </>
            }
            currentUserId={userId}
          />
        </div>
        {/* Status bar */}
        <div
          className={`mt-4 pt-3 border-t flex flex-wrap justify-between gap-2 text-xs shrink-0 ${shellStatusClassName}`}
        >
          <div>{componentVersionStatus}</div>
          <div>CAMPAIGNS: {games.length} MONITORED</div>
        </div>
      </div>
    </main>
  );
}
