"use client";

import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { CampaignIdentity, RoundSegment } from "@/components/campaign-identity";
import { DownloadSaveButton } from "@/components/download-save-button";
import { SaveUploadCard } from "@/components/save-upload-card";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GameListItem } from "@/lib/shadow-cloud-api";
import {
  formatTurnDuration,
  getTurnDurationMs,
  normalizeTurnTargetHours,
} from "@/lib/turn-timing";
import {
  fieldLabel,
  fieldValue,
  padNumber,
  segment,
  segmentLines,
} from "@/lib/terminal-styles";
import { cn } from "@/lib/utils";

type CampaignCardProps = {
  currentUserId?: string;
  game: GameListItem;
};

type CardState = "yours" | "overdue" | "waiting";

const actionText = "text-xs font-bold uppercase tracking-[0.14em]";

const rail: Record<CardState, string> = {
  yours: "border-l-terminal-400",
  overdue: "border-l-destructive",
  waiting: "border-l-terminal-400/40",
};

const barFill: Record<CardState, string> = {
  yours: "bg-terminal-400",
  overdue: "bg-destructive",
  waiting: "bg-terminal-400/60",
};

const numberCell: Record<CardState, string> = {
  yours: "bg-terminal-400 text-primary-foreground",
  overdue: "text-destructive",
  waiting: "text-terminal-300/70",
};

function useMinuteClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    function tick() {
      setNow(new Date());
    }

    tick();
    const intervalId = window.setInterval(tick, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return now;
}

function turnTiming(game: GameListItem, now: Date | null) {
  const elapsedMs =
    now && game.currentTurnStartedAt != null
      ? getTurnDurationMs(
          { startedAt: game.currentTurnStartedAt, endedAt: null },
          now,
        )
      : null;
  const targetHours = normalizeTurnTargetHours(game.turnTargetHours);
  const targetMs = targetHours !== null ? targetHours * 3_600_000 : null;
  const overdueMs =
    elapsedMs !== null && targetMs !== null ? elapsedMs - targetMs : 0;

  return {
    elapsed: formatTurnDuration(elapsedMs),
    target: targetHours !== null ? `${targetHours}h` : "Unknown",
    overdue: overdueMs > 0 ? formatTurnDuration(overdueMs) : null,
    progress:
      elapsedMs !== null && targetMs ? Math.min(elapsedMs / targetMs, 1) : 0,
  };
}

function stopPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={fieldLabel}>{name}</dt>
      <dd className={cn(fieldValue, "truncate")}>{children}</dd>
    </div>
  );
}

function TurnActions({
  game,
  onUpload,
}: {
  game: GameListItem;
  onUpload: () => void;
}) {
  const buttonClassName = cn(
    segment,
    actionText,
    "h-auto flex-1 justify-center gap-2 rounded-none py-2",
  );

  return (
    <div
      className={cn(
        "relative z-10 flex items-stretch divide-x border-t",
        segmentLines,
      )}
      onClick={stopPropagation}
      onKeyDown={stopPropagation}
    >
      {game.latestSave ? (
        <DownloadSaveButton
          className={cn(
            buttonClassName,
            "text-terminal-300 hover:bg-terminal-400/15 hover:text-terminal-200",
          )}
          variant="ghost"
          fileName={game.latestSave.originalName}
          href={`/api/games/${game.gameNumber}/files/${game.latestSave.id}?revision=${game.latestSave.contentRevision}`}
          label={
            <>
              <span aria-hidden="true">▼</span> Download latest turn
            </>
          }
        />
      ) : (
        <button
          type="button"
          disabled
          className={cn(
            buttonClassName,
            "cursor-not-allowed text-terminal-300 opacity-40",
          )}
        >
          <span aria-hidden="true">▼</span> Download latest turn
        </button>
      )}
      <button
        type="button"
        onClick={onUpload}
        className={cn(
          buttonClassName,
          "bg-terminal-400 text-primary-foreground transition-colors hover:bg-terminal-300",
        )}
      >
        <span aria-hidden="true">▲</span> Upload your turn
      </button>
    </div>
  );
}

export function CampaignCard({ currentUserId, game }: CampaignCardProps) {
  const router = useRouter();
  const now = useMinuteClock();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const timing = turnTiming(game, now);
  const isUsersTurn = Boolean(
    currentUserId && game.activePlayerUserId === currentUserId,
  );
  const state: CardState = isUsersTurn
    ? "yours"
    : timing.overdue
      ? "overdue"
      : "waiting";

  function openCampaign() {
    router.push(`/games/${game.gameNumber}`);
  }

  function handleCardKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCampaign();
    }
  }

  return (
    <>
      <div
        className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        role="link"
        tabIndex={0}
        onClick={openCampaign}
        onKeyDown={handleCardKeyDown}
      >
        <Card
          className={cn(
            "gap-0 overflow-hidden border-l-[6px] border-terminal-400/20 bg-transparent py-0 transition-all group-hover:bg-terminal-400/10",
            rail[state],
          )}
        >
          <div
            className={cn(
              "flex items-stretch divide-x border-b text-sm",
              segmentLines,
              isUsersTurn && "bg-terminal-400/15",
            )}
          >
            <span
              className={cn(
                segment,
                "min-w-12 justify-center font-bold tabular-nums",
                numberCell[state],
              )}
            >
              {padNumber(game.gameNumber)}
            </span>
            <RoundSegment roundNumber={game.roundNumber} />
            <CampaignIdentity
              game={game}
              className="group-hover:text-terminal-200"
            />
          </div>
          <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 md:grid-cols-4">
            <div className="col-span-2 min-w-0 md:col-span-1">
              <dt className={fieldLabel}>Elapsed / target</dt>
              <dd className={cn(fieldValue, "truncate")}>
                {`${timing.elapsed} / ${timing.target}`}
                {timing.overdue ? (
                  <span className="text-destructive">{` · ${timing.overdue} over`}</span>
                ) : null}
              </dd>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-terminal-400/15">
                <div
                  className={cn(
                    "h-full rounded-full",
                    timing.overdue ? "bg-destructive" : barFill[state],
                  )}
                  style={{ width: `${Math.round(timing.progress * 100)}%` }}
                />
              </div>
            </div>
            <Field name="Active lord">{game.activePlayerDisplayName}</Field>
            <Field name="Overlord">{game.organizerDisplayName}</Field>
            <Field name="Seats">
              {`${game.filledSeatCount}/${game.playerCount}`}
            </Field>
          </dl>
          {isUsersTurn ? (
            <TurnActions
              game={game}
              onUpload={() => {
                setIsUploadModalOpen(true);
              }}
            />
          ) : null}
        </Card>
      </div>

      <Dialog open={isUploadModalOpen} onOpenChange={setIsUploadModalOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto"
        >
          <DialogTitle className="sr-only">Save upload</DialogTitle>
          <DialogCloseButton
            aria-label="Close save upload"
            className="absolute top-4 right-4 z-10"
            onClick={() => {
              setIsUploadModalOpen(false);
            }}
          />
          <SaveUploadCard
            saveBaseline={game.saveBaseline}
            activePlayerDisplayName={game.activePlayerDisplayName}
            gameNumber={game.gameNumber}
            isActivePlayer={isUsersTurn}
            isSignedIn={Boolean(currentUserId)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
