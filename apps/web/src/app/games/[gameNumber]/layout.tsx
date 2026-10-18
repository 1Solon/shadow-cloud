import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerAuthSession } from "@/auth";
import { CampaignIdentity, RoundSegment } from "@/components/campaign-identity";
import { TerminalFrame } from "@/components/terminal-frame";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";
import { getGameDetail } from "@/lib/shadow-cloud-api";
import { padNumber, segment, segmentLines } from "@/lib/terminal-styles";
import { cn } from "@/lib/utils";

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

  if (!game) {
    notFound();
  }

  return (
    <main className="min-h-dvh md:h-dvh md:overflow-hidden bg-background font-mono p-2 sm:p-4 flex flex-col text-terminal-400">
      <TerminalFrame
        user={session?.user}
        overrideEnabled={shadowOverrideEnabled}
        homeLink
      >
        <nav
          aria-label="Campaign"
          className={cn(
            "mb-4 flex shrink-0 items-stretch divide-x overflow-hidden rounded-lg border text-sm",
            segmentLines,
          )}
        >
          <Link
            href="/"
            className={cn(
              segment,
              "px-3 text-xs font-bold uppercase tracking-[0.14em] text-terminal-300 transition-colors hover:bg-terminal-400/10 hover:text-terminal-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            )}
          >
            <span aria-hidden="true">◀&nbsp;</span>Back
          </Link>
          <span
            className={cn(
              segment,
              "min-w-12 justify-center font-bold tabular-nums text-terminal-300/70",
            )}
          >
            <span className="sr-only">Campaign </span>
            {padNumber(game.gameNumber)}
          </span>
          <RoundSegment roundNumber={game.roundNumber} />
          <h1 className="flex min-w-0 flex-1">
            <CampaignIdentity game={game} />
          </h1>
        </nav>

        <div className="flex-1 min-h-0 md:overflow-y-auto md:pr-2">
          {children}
        </div>
      </TerminalFrame>
    </main>
  );
}
