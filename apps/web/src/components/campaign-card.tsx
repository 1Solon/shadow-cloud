"use client";

import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { SaveUploadCard } from "@/components/save-upload-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { GameListItem } from "@/lib/shadow-cloud-api";
import { cn } from "@/lib/utils";

type CampaignCardProps = {
  currentUserId?: string;
  game: GameListItem;
};

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function CampaignCard({ currentUserId, game }: CampaignCardProps) {
  const router = useRouter();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploadButtonHighlighted, setIsUploadButtonHighlighted] =
    useState(false);
  const isUsersTurn = Boolean(
    currentUserId && game.activePlayerUserId === currentUserId,
  );
  const cardHighlightClassName = isUploadButtonHighlighted
    ? null
    : "group-hover:bg-orange-400/10 group-hover:shadow-lg group-hover:shadow-orange-400/10";

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
        className="group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        role="link"
        tabIndex={0}
        onClick={() => {
          router.push(`/games/${game.gameNumber}`);
        }}
        onKeyDown={handleCardKeyDown}
      >
        <Card
          className={cn(
            "h-full bg-black/50 border-orange-400 transition-all group-focus-visible:bg-orange-400 group-focus-visible:text-black group-focus-visible:shadow-lg group-focus-visible:shadow-orange-400/20",
            cardHighlightClassName,
          )}
        >
          <CardContent className="grid gap-6 pt-6 md:grid-cols-2">
            <div
              className={cn(
                "flex flex-col gap-1 border-b border-orange-400/20 pb-4 group-focus-visible:border-black/20 md:border-b-0 md:border-r md:pb-0 md:pr-6",
                !isUploadButtonHighlighted
                  ? "group-hover:border-orange-300/30"
                  : null,
              )}
            >
              <div
                className={cn(
                  "text-lg font-semibold text-orange-300 group-focus-visible:text-black",
                  !isUploadButtonHighlighted
                    ? "group-hover:text-orange-200"
                    : null,
                )}
              >
                {`${game.gameNumber} : ${game.name}`}
              </div>
              <div
                className={cn(
                  "text-xs text-orange-300/60 group-focus-visible:text-black/70",
                  !isUploadButtonHighlighted
                    ? "group-hover:text-orange-200/70"
                    : null,
                )}
              >
                Overlord {game.organizerDisplayName}
              </div>
              <div
                className={cn(
                  "mt-1 text-xs uppercase tracking-[0.18em] text-orange-300/50 group-focus-visible:text-black/60",
                  !isUploadButtonHighlighted
                    ? "group-hover:text-orange-200/60"
                    : null,
                )}
              >
                Turn {game.roundNumber}
              </div>
              <div
                className={cn(
                  "mt-1 text-xs uppercase tracking-[0.18em] text-orange-300/40 group-focus-visible:text-black/55",
                  !isUploadButtonHighlighted
                    ? "group-hover:text-orange-200/55"
                    : null,
                )}
              >
                Updated {formatTimestamp(game.updatedAt)}
              </div>
            </div>

            <div className="flex flex-col gap-1 md:pl-2">
              <div className="flex items-center gap-4 px-1 py-1">
                <div
                  className={cn(
                    "w-32 shrink-0 text-xs uppercase tracking-[0.2em] text-orange-300/70 group-focus-visible:text-black/70",
                    !isUploadButtonHighlighted
                      ? "group-hover:text-orange-200/70"
                      : null,
                  )}
                >
                  Active lord
                </div>
                <div
                  className={cn(
                    "text-sm font-medium text-orange-300 transition-all group-focus-visible:text-black",
                    !isUploadButtonHighlighted
                      ? "group-hover:text-orange-200"
                      : null,
                  )}
                >
                  {game.activePlayerDisplayName}
                </div>
              </div>
              <div className="flex items-center gap-4 px-1 py-1">
                <div
                  className={cn(
                    "w-32 shrink-0 text-xs uppercase tracking-[0.2em] text-orange-300/70 group-focus-visible:text-black/70",
                    !isUploadButtonHighlighted
                      ? "group-hover:text-orange-200/70"
                      : null,
                  )}
                >
                  Overlord
                </div>
                <div
                  className={cn(
                    "text-sm font-medium text-orange-300 group-focus-visible:text-black",
                    !isUploadButtonHighlighted
                      ? "group-hover:text-orange-200"
                      : null,
                  )}
                >
                  {game.organizerDisplayName}
                </div>
              </div>
              <div className="flex items-center gap-4 px-1 py-1">
                <div
                  className={cn(
                    "w-32 shrink-0 text-xs uppercase tracking-[0.2em] text-orange-300/70 group-focus-visible:text-black/70",
                    !isUploadButtonHighlighted
                      ? "group-hover:text-orange-200/70"
                      : null,
                  )}
                >
                  Seats
                </div>
                <div
                  className={cn(
                    "text-sm font-medium text-orange-300 group-focus-visible:text-black",
                    !isUploadButtonHighlighted
                      ? "group-hover:text-orange-200"
                      : null,
                  )}
                >
                  {`${game.filledSeatCount} / ${game.playerCount}`}
                </div>
              </div>
            </div>

            {isUsersTurn ? (
              <div className="relative z-10 w-full md:col-span-2">
                <Button
                  className="w-full"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
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
              className="absolute right-4 top-4 z-10 text-orange-300/70 transition-colors hover:text-orange-200"
              type="button"
              onClick={() => {
                setIsUploadModalOpen(false);
              }}
            >
              X
            </button>
            <SaveUploadCard
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
