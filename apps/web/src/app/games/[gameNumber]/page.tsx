import { notFound } from "next/navigation";
import { AdministratorActionsCard } from "@/components/administrator-actions-card";
import { getServerAuthSession } from "@/auth";
import { CampaignDetailsWorkspace } from "@/components/campaign-details-workspace";
import { CampaignWorkspaceTabs } from "@/components/campaign-workspace-tabs";
import { TerminalConfirmationModal } from "@/components/terminal-confirmation-modal";
import { TurnCommandCenter } from "@/components/turn-command-center";
import { TurnTimingHistoryCard } from "@/components/turn-timing-history-card";
import { WorldStateHistoryCard } from "@/components/world-state-history-card";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";
import { getGameDetail } from "@/lib/shadow-cloud-api";

type GamePageProps = {
  params: Promise<{
    gameNumber: string;
  }>;
  searchParams: Promise<{
    metadata?: string;
    upload?: string;
    message?: string;
  }>;
};

export default async function GameDetailPage({
  params,
  searchParams,
}: GamePageProps) {
  const { gameNumber } = await params;
  const query = await searchParams;
  const [session, game, shadowOverrideEnabled] = await Promise.all([
    getServerAuthSession(),
    getGameDetail(gameNumber),
    getShadowOverrideEnabled(),
  ]);

  if (!game) {
    notFound();
  }

  const isActivePlayer = Boolean(
    session?.user?.id && game.activePlayerUserId === session.user.id,
  );
  const canEditSeatOrder = Boolean(
    session?.user?.id &&
    (session.user.id === game.organizerId ||
      (session.user.isShadowOverride && shadowOverrideEnabled)),
  );
  const canDeleteGame = Boolean(
    session?.user?.isShadowOverride && shadowOverrideEnabled,
  );
  const uploadMessage = query.message
    ? decodeURIComponent(query.message)
    : null;
  const initialNow = new Date().toISOString();
  const activePlayer = game.players.find(
    (player) => player.id === game.activePlayerEntryId,
  );
  const latestFileVersion = game.fileVersions[0];
  const latestSave = latestFileVersion
    ? {
        id: latestFileVersion.id,
        originalName: latestFileVersion.originalName,
        uploadedAt: latestFileVersion.uploadedAt,
        uploadedByDisplayName: latestFileVersion.uploadedByDisplayName,
      }
    : null;
  const currentTurnStartedAt =
    game.currentTurnStartedAt ?? game.openTurn?.startedAt ?? null;

  return (
    <div className="flex flex-col gap-8 pb-6">
      <TerminalConfirmationModal
        confirmation={
          query.metadata === "success"
            ? {
                command: "game-metadata --commit",
                lines: [
                  "[ok] campaign metadata written to the command archive",
                  "[ok] world configuration refreshed for connected operators",
                  "<CAMPAIGN DETAILS UPDATED>",
                ],
              }
            : query.upload === "success"
              ? {
                  command: "save-upload --dispatch",
                  lines: [
                    "[ok] save file accepted into the active campaign archive",
                    "[ok] next lord notification dispatched to the Discord thread",
                    "<SAVE FILE UPLOADED>",
                  ],
                }
              : null
        }
      />
      {query.upload === "error" ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300 font-mono">
          {uploadMessage ?? "The save upload failed."}
        </div>
      ) : null}

      <TurnCommandCenter
        activePlayerDisplayName={game.activePlayerDisplayName}
        activeSeatNumber={
          activePlayer?.turnOrder ?? game.openTurn?.seatNumber ?? null
        }
        canDownloadLatestSave={latestSave !== null}
        currentTurnStartedAt={currentTurnStartedAt}
        gameNumber={game.gameNumber}
        initialNow={initialNow}
        isActivePlayer={isActivePlayer}
        isSignedIn={Boolean(session?.user)}
        key={game.openTurn?.id ?? "no-open-turn"}
        latestSave={latestSave}
        roundNumber={game.roundNumber}
        turnTargetHours={game.turnTargetHours}
      />

      <CampaignWorkspaceTabs
        activity={
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
            <WorldStateHistoryCard
              currentUserId={session?.user?.id ?? null}
              fileVersions={game.fileVersions}
              gameNumber={game.gameNumber}
              isShadowOverrideUser={session?.user?.isShadowOverride === true}
              shadowOverrideEnabled={shadowOverrideEnabled}
            />
            <TurnTimingHistoryCard
              initialNow={initialNow}
              key={game.openTurn?.id ?? "no-open-turn"}
              openTurn={game.openTurn}
              recentCompletedTurns={game.recentCompletedTurns}
            />
          </div>
        }
        administration={
          canDeleteGame ? (
            <AdministratorActionsCard
              gameName={game.name}
              gameNumber={game.gameNumber}
            />
          ) : undefined
        }
        campaign={
          <CampaignDetailsWorkspace
            activePlayerEntryId={game.activePlayerEntryId}
            armyCount={game.armyCount}
            canEdit={canEditSeatOrder}
            dlcMode={game.dlcMode}
            gameMode={game.gameMode}
            gameNumber={game.gameNumber}
            hasAiPlayers={game.hasAiPlayers}
            name={game.name}
            notes={game.notes}
            organizerDisplayName={game.organizerDisplayName}
            playerCount={game.playerCount}
            players={game.players}
            roundNumber={game.roundNumber}
            techLevel={game.techLevel}
            turnReminderGraceHours={game.turnReminderGraceHours}
            turnReminderRepeatHours={game.turnReminderRepeatHours}
            turnRemindersEnabled={game.turnRemindersEnabled}
            turnTargetHours={game.turnTargetHours}
            zoneCount={game.zoneCount}
          />
        }
      />
    </div>
  );
}
