import { notFound } from "next/navigation";
import { AdministratorActionsCard } from "@/components/administrator-actions-card";
import { getServerAuthSession } from "@/auth";
import { GameMetadataCard } from "@/components/game-metadata-card";
import { GameNotesCard } from "@/components/game-notes-card";
import { SaveUploadCard } from "@/components/save-upload-card";
import { SeatOrderEditor } from "@/components/seat-order-editor";
import { TerminalConfirmationModal } from "@/components/terminal-confirmation-modal";
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

  return (
    <div className="flex flex-col gap-8">
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

      {canDeleteGame ? (
        <section>
          <AdministratorActionsCard
            gameName={game.name}
            gameNumber={game.gameNumber}
          />
        </section>
      ) : null}

      <section className="scroll-mt-6" id="save-upload">
        <SaveUploadCard
          activePlayerDisplayName={game.activePlayerDisplayName}
          gameNumber={game.gameNumber}
          isActivePlayer={isActivePlayer}
          isSignedIn={Boolean(session?.user)}
        />
      </section>

      <section>
        <GameNotesCard
          canEdit={canEditSeatOrder}
          gameNumber={game.gameNumber}
          notes={game.notes}
        />
      </section>

      <section>
        <GameMetadataCard
          activePlayerDisplayName={game.activePlayerDisplayName}
          armyCount={game.armyCount}
          canEdit={canEditSeatOrder}
          dlcMode={game.dlcMode}
          gameMode={game.gameMode}
          gameNumber={game.gameNumber}
          hasAiPlayers={game.hasAiPlayers}
          name={game.name}
          organizerDisplayName={game.organizerDisplayName}
          players={game.players}
          playerCount={game.playerCount}
          roundNumber={game.roundNumber}
          techLevel={game.techLevel}
          zoneCount={game.zoneCount}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <SeatOrderEditor
          activePlayerEntryId={game.activePlayerEntryId}
          canEdit={canEditSeatOrder}
          gameNumber={game.gameNumber}
          players={game.players}
        />

        <div className="grid gap-6">
          <WorldStateHistoryCard
            currentUserId={session?.user?.id ?? null}
            fileVersions={game.fileVersions}
            gameNumber={game.gameNumber}
            isShadowOverrideUser={session?.user?.isShadowOverride === true}
            shadowOverrideEnabled={shadowOverrideEnabled}
          />
        </div>
      </section>
    </div>
  );
}
