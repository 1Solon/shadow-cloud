import { notFound } from "next/navigation";
import { AdministratorActionsCard } from "@/components/administrator-actions-card";
import { getServerAuthSession } from "@/auth";
import { DownloadSaveButton } from "@/components/download-save-button";
import { GameMetadataCard } from "@/components/game-metadata-card";
import { GameNotesCard } from "@/components/game-notes-card";
import { SaveUploadCard } from "@/components/save-upload-card";
import { SeatOrderEditor } from "@/components/seat-order-editor";
import { TerminalConfirmationModal } from "@/components/terminal-confirmation-modal";
import {
  CardContent,
  CardHeader,
  Card,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
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

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

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
          <Card>
            <CardHeader>
              <CardTitle>World states:</CardTitle>
              <CardDescription>
                The current state of the game world, including all uploaded turn
                files.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {game.fileVersions.length === 0 ? (
                <div className="rounded-lg border border-orange-400/20 bg-orange-400/5 px-4 py-4 text-sm text-orange-300 font-mono">
                  No turn files have been uploaded yet.
                </div>
              ) : (
                game.fileVersions.map((fileVersion, index) => {
                  const isMostRecent = index === 0;
                  return (
                    <div
                      key={fileVersion.id}
                      className={`rounded-lg border px-4 py-4 ${isMostRecent ? "border-orange-400 bg-orange-400 text-black" : "border-orange-400/20 bg-orange-400/5"}`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div
                          className={`font-medium ${isMostRecent ? "text-black" : "text-orange-300"}`}
                        >
                          {fileVersion.originalName}
                        </div>
                        <div className="flex items-center gap-3">
                          {session?.user ? (
                            <DownloadSaveButton
                              className={`inline-flex h-9 items-center rounded-md border px-3 text-xs font-medium uppercase tracking-[0.18em] font-mono transition-colors ${isMostRecent ? "border-black bg-black/10 text-black hover:bg-black hover:text-orange-400" : "border-orange-400 bg-orange-400/10 text-orange-300 hover:bg-orange-400 hover:text-black"}`}
                              fileName={fileVersion.originalName}
                              href={`/api/games/${game.gameNumber}/files/${fileVersion.id}`}
                            />
                          ) : null}
                        </div>
                      </div>
                      <div
                        className={`mt-2 text-sm font-mono ${isMostRecent ? "text-black/60" : "text-orange-300/70"}`}
                      >
                        Uploaded by {fileVersion.uploadedByDisplayName} on{" "}
                        {formatTimestamp(fileVersion.uploadedAt)}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
