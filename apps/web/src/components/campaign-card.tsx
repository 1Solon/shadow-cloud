"use client";

import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { DownloadSaveButton } from "@/components/download-save-button";
import { SaveUploadCard } from "@/components/save-upload-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { GameListItem } from "@/lib/shadow-cloud-api";
import {
  formatTurnDuration,
  getTurnDurationMs,
  normalizeTurnTargetHours,
} from "@/lib/turn-timing";
import { cn } from "@/lib/utils";

type CampaignCardProps = {
  currentUserId?: string;
  game: GameListItem;
};

export function formatRelativeTimestamp(timestamp: string, now: number) {
  const updatedAt = Date.parse(timestamp);
  if (!Number.isFinite(updatedAt)) {
    return "unknown time";
  }

  const differenceInSeconds = Math.round((updatedAt - now) / 1000);
  const absoluteDifferenceInSeconds = Math.abs(differenceInSeconds);
  if (absoluteDifferenceInSeconds < 60) {
    return "just now";
  }

  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ] as const;
  const [unit, secondsPerUnit] = units.find(
    ([, seconds]) => absoluteDifferenceInSeconds >= seconds,
  ) ?? ["second", 1];

  return new Intl.RelativeTimeFormat("en-US", { numeric: "auto" }).format(
    Math.round(differenceInSeconds / secondsPerUnit),
    unit,
  );
}

export function CampaignCard({ currentUserId, game }: CampaignCardProps) {
  const router = useRouter();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploadButtonHighlighted, setIsUploadButtonHighlighted] =
    useState(false);
  const [relativeUpdatedAt, setRelativeUpdatedAt] = useState(game.updatedAt);
  const [now, setNow] = useState<Date | null>(null);
  const elapsedMs =
    now && game.currentTurnStartedAt != null
      ? getTurnDurationMs(
          { startedAt: game.currentTurnStartedAt, endedAt: null },
          now,
        )
      : null;
  const elapsed = formatTurnDuration(elapsedMs);
  const targetHours = normalizeTurnTargetHours(game.turnTargetHours);
  const target = targetHours !== null ? `${targetHours}h` : "Unknown";
  const overdueMs =
    elapsedMs !== null && targetHours !== null
      ? elapsedMs - targetHours * 3_600_000
      : 0;
  const isUsersTurn = Boolean(
    currentUserId && game.activePlayerUserId === currentUserId,
  );
  const cardHighlightClassName = isUploadButtonHighlighted
    ? null
    : "group-hover:bg-terminal-400/10 group-hover:shadow-lg group-hover:shadow-terminal-400/10";

  useEffect(() => {
    function updateRelativeTimestamp() {
      setNow(new Date());
      setRelativeUpdatedAt(formatRelativeTimestamp(game.updatedAt, Date.now()));
    }

    updateRelativeTimestamp();
    const intervalId = window.setInterval(updateRelativeTimestamp, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [game.updatedAt]);

  useEffect(() => {
    if (!isUploadModalOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsUploadModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isUploadModalOpen]);

  function openUploadModal(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setIsUploadModalOpen(true);
  }

  function handleCardKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    router.push(`/games/${game.gameNumber}`);
  }

  return (
    <>
      <div
        className="group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        role="link"
        tabIndex={0}
        onClick={() => {
          router.push(`/games/${game.gameNumber}`);
        }}
        onKeyDown={handleCardKeyDown}
      >
        <Card
          className={cn(
            "h-full bg-surface/50 border-terminal-400 transition-all group-focus-visible:bg-terminal-400 group-focus-visible:text-primary-foreground group-focus-visible:shadow-lg group-focus-visible:shadow-terminal-400/20",
            cardHighlightClassName,
          )}
        >
          <CardContent className="grid gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] md:items-center">
            <div
              className={cn(
                "flex min-w-0 flex-col gap-1 border-b border-terminal-400/20 pb-3 group-focus-visible:border-primary-foreground/20 md:border-b-0 md:border-r md:pb-0 md:pr-5",
                !isUploadButtonHighlighted
                  ? "group-hover:border-terminal-300/30"
                  : null,
              )}
            >
              <div
                className={cn(
                  "text-lg font-semibold text-terminal-300 group-focus-visible:text-primary-foreground",
                  !isUploadButtonHighlighted
                    ? "group-hover:text-terminal-200"
                    : null,
                )}
              >
                {`${game.gameNumber} : ${game.name}`}
              </div>
              <div
                className={cn(
                  "mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground group-focus-visible:text-primary-foreground/70",
                  !isUploadButtonHighlighted
                    ? "group-hover:text-terminal-200/70"
                    : null,
                )}
              >
                {isUsersTurn ? (
                  <span className="rounded-sm bg-terminal-400 px-1.5 py-0.5 font-bold uppercase tracking-[0.16em] text-primary-foreground">
                    Your turn
                  </span>
                ) : null}
                <span className="text-muted-foreground group-focus-visible:text-primary-foreground/70">
                  Turn {game.roundNumber}
                </span>
                <time
                  dateTime={game.updatedAt}
                  title={`Updated ${game.updatedAt}`}
                  className="text-muted-foreground group-focus-visible:text-primary-foreground/70"
                >
                  Updated {relativeUpdatedAt}
                </time>
              </div>
            </div>

            <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-3 md:gap-x-4 md:pl-1">
              <div className="col-span-2 min-w-0 px-1 md:col-span-3">
                <dt className="text-xs uppercase tracking-[0.16em] text-terminal-300/70 group-focus-visible:text-primary-foreground/70">
                  Elapsed / target
                </dt>
                <dd className="text-sm font-medium text-terminal-300 group-focus-visible:text-primary-foreground">
                  {`${elapsed} / ${target}`}
                  {overdueMs > 0 ? (
                    <span className="text-destructive group-focus-visible:text-primary-foreground">
                      {` · ${formatTurnDuration(overdueMs)} over`}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className="min-w-0 px-1">
                <dt
                  className={cn(
                    "text-xs uppercase tracking-[0.16em] text-terminal-300/70 group-focus-visible:text-primary-foreground/70",
                    !isUploadButtonHighlighted
                      ? "group-hover:text-terminal-200/70"
                      : null,
                  )}
                >
                  Active lord
                </dt>
                <dd
                  className={cn(
                    "truncate text-sm font-medium text-terminal-300 transition-all group-focus-visible:text-primary-foreground",
                    !isUploadButtonHighlighted
                      ? "group-hover:text-terminal-200"
                      : null,
                  )}
                >
                  {game.activePlayerDisplayName}
                </dd>
              </div>
              <div className="min-w-0 px-1">
                <dt
                  className={cn(
                    "text-xs uppercase tracking-[0.16em] text-terminal-300/70 group-focus-visible:text-primary-foreground/70",
                    !isUploadButtonHighlighted
                      ? "group-hover:text-terminal-200/70"
                      : null,
                  )}
                >
                  Overlord
                </dt>
                <dd
                  className={cn(
                    "text-sm font-medium text-terminal-300 group-focus-visible:text-primary-foreground",
                    !isUploadButtonHighlighted
                      ? "group-hover:text-terminal-200"
                      : null,
                  )}
                >
                  {game.organizerDisplayName}
                </dd>
              </div>
              <div className="min-w-0 px-1">
                <dt
                  className={cn(
                    "text-xs uppercase tracking-[0.16em] text-terminal-300/70 group-focus-visible:text-primary-foreground/70",
                    !isUploadButtonHighlighted
                      ? "group-hover:text-terminal-200/70"
                      : null,
                  )}
                >
                  Seats
                </dt>
                <dd
                  className={cn(
                    "text-sm font-medium text-terminal-300 group-focus-visible:text-primary-foreground",
                    !isUploadButtonHighlighted
                      ? "group-hover:text-terminal-200"
                      : null,
                  )}
                >
                  {`${game.filledSeatCount} / ${game.playerCount}`}
                </dd>
              </div>
            </dl>

            {isUsersTurn ? (
              <div
                className="relative z-10 grid w-full grid-cols-2 gap-2 md:col-span-2"
                onClick={(event) => {
                  event.stopPropagation();
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
              >
                {game.latestSave ? (
                  <DownloadSaveButton
                    className="h-9 w-full px-2 text-xs sm:px-4 sm:text-sm"
                    variant="outline"
                    fileName={game.latestSave.originalName}
                    href={`/api/games/${game.gameNumber}/files/${game.latestSave.id}?revision=${game.latestSave.contentRevision}`}
                    label="Download latest turn"
                  />
                ) : (
                  <Button
                    className="h-9 w-full px-2 text-xs sm:px-4 sm:text-sm"
                    disabled
                    variant="outline"
                  >
                    Download latest turn
                  </Button>
                )}
                <Button
                  className="h-9 w-full px-2 text-xs sm:px-4 sm:text-sm"
                  type="button"
                  onBlur={() => {
                    setIsUploadButtonHighlighted(false);
                  }}
                  onClick={openUploadModal}
                  onFocus={() => {
                    setIsUploadButtonHighlighted(true);
                  }}
                  onMouseEnter={() => {
                    setIsUploadButtonHighlighted(true);
                  }}
                  onMouseLeave={() => {
                    setIsUploadButtonHighlighted(false);
                  }}
                >
                  {"> Upload your turn"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {isUploadModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-card p-4 backdrop-blur-sm"
          onClick={() => {
            setIsUploadModalOpen(false);
          }}
        >
          <div
            className="relative w-full max-w-3xl"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <button
              aria-label="Close save upload"
              className="absolute right-4 top-4 z-10 text-terminal-300/70 transition-colors hover:text-terminal-200"
              type="button"
              onClick={() => {
                setIsUploadModalOpen(false);
              }}
            >
              X
            </button>
            <SaveUploadCard
              saveBaseline={game.saveBaseline}
              activePlayerDisplayName={game.activePlayerDisplayName}
              gameNumber={game.gameNumber}
              isActivePlayer={isUsersTurn}
              isSignedIn={Boolean(currentUserId)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
