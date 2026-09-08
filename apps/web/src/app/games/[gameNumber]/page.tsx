import { notFound } from "next/navigation";
import { AdministratorActionsCard } from "@/components/administrator-actions-card";
import { getServerAuthSession } from "@/auth";
import { CampaignDetailsWorkspace } from "@/components/campaign-details-workspace";
import { CampaignWorkspaceTabs } from "@/components/campaign-workspace-tabs";
import { TerminalConfirmationModal } from "@/components/terminal-confirmation-modal";
import { TurnCommandCenter } from "@/components/turn-command-center";
import { TurnTimingHistoryCard } from "@/components/turn-timing-history-card";
import { WorldStateHistoryCard } from "@/components/world-state-history-card";
import { SaveRegimeInspection } from "@/components/save-regime-inspection";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";
import { getGameDetail } from "@/lib/shadow-cloud-api";
import { transferOutcomeMessage } from "@/lib/transfer-outcome";

type GamePageProps = {
  params: Promise<{
    gameNumber: string;
  }>;
  searchParams: Promise<{
    metadata?: string;
    upload?: string;
    message?: string;
    transferOutcome?: string | string[];
    transferRecovery?: string | string[];
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
  const isOverlord = Boolean(
    session?.user?.id && session.user.id === game.organizerId,
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
  const currentTurnStartedAt =
    game.currentTurnStartedAt ?? game.openTurn?.startedAt ?? null;
  const transferNotice = transferOutcomeMessage(query.transferOutcome);
  // Echo only a well-formed correlation nonce after the authoritative read.
  // It carries no ownership, permissions or instruction to retry a mutation.
  const identityReadId =
    typeof query.transferRecovery === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      query.transferRecovery,
    )
      ? query.transferRecovery
      : "";

  return (
    <div className="flex flex-col gap-8 pb-6">
      {transferNotice ? (
        <p
          role="status"
          className="border border-orange-400/30 bg-orange-400/10 px-4 py-3 text-sm font-mono text-orange-200"
        >
          {transferNotice}
        </p>
      ) : null}
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
        saveBaseline={game.saveBaseline}
        activePlayerDisplayName={game.activePlayerDisplayName}
        activeSeatNumber={
          activePlayer?.turnOrder ?? game.openTurn?.seatNumber ?? null
        }
        currentTurnStartedAt={currentTurnStartedAt}
        gameNumber={game.gameNumber}
        initialNow={initialNow}
        isActivePlayer={isActivePlayer}
        isSignedIn={Boolean(session?.user)}
        key={game.openTurn?.id ?? "no-open-turn"}
        latestSave={game.fileVersions[0] ?? null}
        notes={game.notes ?? ""}
        roundNumber={game.roundNumber}
        turnTargetHours={game.turnTargetHours}
      />

      <CampaignWorkspaceTabs
        saves={
          <WorldStateHistoryCard
            saveBaseline={game.saveBaseline}
            currentUserId={session?.user?.id ?? null}
            fileVersions={game.fileVersions}
            gameNumber={game.gameNumber}
            isShadowOverrideUser={session?.user?.isShadowOverride === true}
            shadowOverrideEnabled={shadowOverrideEnabled}
          />
        }
        timing={
          <TurnTimingHistoryCard
            initialNow={initialNow}
            key={game.openTurn?.id ?? "no-open-turn"}
            openTurn={game.openTurn}
            recentCompletedTurns={game.recentCompletedTurns}
          />
        }
        campaign={
          <CampaignDetailsWorkspace
            identityReadId={identityReadId}
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
            seatOrderBaseline={game.seatOrderBaseline}
            roundNumber={game.roundNumber}
            techLevel={game.techLevel}
            turnReminderGraceHours={game.turnReminderGraceHours}
            turnReminderRepeatHours={game.turnReminderRepeatHours}
            turnRemindersEnabled={game.turnRemindersEnabled}
            turnTargetHours={game.turnTargetHours}
            zoneCount={game.zoneCount}
          />
        }
        regimes={
          isOverlord ? (
            <SaveRegimeInspection
              key={game.id}
              saveRevision={`${game.fileVersions[0]?.id}:${game.fileVersions[0]?.contentRevision}`}
              gameNumber={game.gameNumber}
              isOverlord={isOverlord}
              hasSave={game.fileVersions.length > 0}
            />
          ) : undefined
        }
        administration={
          canDeleteGame ? (
            <AdministratorActionsCard
              gameName={game.name}
              gameNumber={game.gameNumber}
            />
          ) : undefined
        }
      />
    </div>
  );
}
