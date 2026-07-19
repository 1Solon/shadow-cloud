"use client";

import { useEffect, useId, useState } from "react";
import { DownloadSaveButton } from "@/components/download-save-button";
import { GameNotesMarkdown } from "@/components/game-notes-markdown";
import { UploadSaveForm } from "@/components/upload-save-form";
import {
  formatTurnDuration,
  formatTurnTimestamp,
  getTurnDurationMs,
} from "@/lib/turn-timing";

export type TurnCommandCenterLatestSave = {
  id: string;
  originalName: string;
  uploadedAt: string;
  uploadedByDisplayName: string;
};

export type TurnCommandCenterProps = {
  activePlayerDisplayName: string;
  activeSeatNumber: number | null;
  canDownloadLatestSave: boolean;
  currentTurnStartedAt: string | null;
  gameNumber: number;
  initialNow: string;
  isActivePlayer: boolean;
  isSignedIn: boolean;
  latestSave: TurnCommandCenterLatestSave | null;
  notes: string;
  roundNumber: number;
  turnTargetHours: number;
};

const refreshIntervalMs = 60 * 1000;

function LatestSaveTimestamp({ timestamp }: { timestamp: string }) {
  const formattedTimestamp = formatTurnTimestamp(timestamp);

  if (formattedTimestamp === "Unknown") {
    return "Unknown";
  }

  return <time dateTime={timestamp}>{formattedTimestamp}</time>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] uppercase tracking-[0.18em] text-orange-300/60">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-semibold text-orange-100 sm:text-base">
        {value}
      </dd>
    </div>
  );
}

export function TurnCommandCenter({
  activePlayerDisplayName,
  activeSeatNumber,
  canDownloadLatestSave,
  currentTurnStartedAt,
  gameNumber,
  initialNow,
  isActivePlayer,
  isSignedIn,
  latestSave,
  notes,
  roundNumber,
  turnTargetHours,
}: TurnCommandCenterProps) {
  const headingId = useId();
  const [now, setNow] = useState(() => new Date(initialNow));
  const hasValidTurnStart =
    currentTurnStartedAt !== null &&
    !Number.isNaN(new Date(currentTurnStartedAt).getTime());

  useEffect(() => {
    if (!hasValidTurnStart) {
      return;
    }

    const interval = window.setInterval(() => {
      setNow(new Date());
    }, refreshIntervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [currentTurnStartedAt, hasValidTurnStart]);

  const elapsedMs =
    hasValidTurnStart && currentTurnStartedAt !== null
      ? getTurnDurationMs(
          { startedAt: currentTurnStartedAt, endedAt: null },
          now,
        )
      : null;
  const elapsed = hasValidTurnStart ? formatTurnDuration(elapsedMs) : "Unknown";
  const target =
    Number.isSafeInteger(turnTargetHours) && turnTargetHours > 0
      ? `${turnTargetHours}h`
      : "Unknown";
  const canUpload = isSignedIn && isActivePlayer;
  const hasNotes = notes.trim().length > 0;

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-lg border border-orange-400/40 bg-black font-mono text-orange-100"
    >
      <h2 className="sr-only" id={headingId}>
        Current turn
      </h2>
      <div
        className={
          canUpload
            ? "border-b border-orange-400 bg-orange-400 px-4 py-2 text-xs font-bold tracking-[0.2em] text-black"
            : "border-b border-orange-400/40 bg-orange-400/10 px-4 py-2 text-xs font-bold tracking-[0.2em] text-orange-300"
        }
      >
        {canUpload ? "YOUR TURN" : "WAITING"}
      </div>

      <div
        className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
        data-testid="command-center-body"
      >
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-2">
            <Metric label="Active lord" value={activePlayerDisplayName} />
            <Metric
              label="Seat"
              value={
                activeSeatNumber === null
                  ? "Seat unknown"
                  : `Seat ${activeSeatNumber}`
              }
            />
            <Metric label="Round" value={`Round ${roundNumber}`} />
            <Metric label="Elapsed / target" value={`${elapsed} / ${target}`} />
          </dl>

          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.18em] text-orange-300/60">
              Campaign notes
            </p>
            {hasNotes ? (
              <GameNotesMarkdown
                content={notes}
                className="mt-2 rounded-none border-0 bg-transparent px-0 py-0"
              />
            ) : (
              <p className="mt-2 text-sm leading-6 text-orange-200/60">
                No campaign notes recorded.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4 border-t border-orange-400/20 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div>
            <h2 className="text-xs uppercase tracking-[0.18em] text-orange-300/60">
              Latest save
            </h2>
            {latestSave ? (
              <div className="mt-2 space-y-1">
                <p className="break-all text-sm font-semibold text-orange-100">
                  {latestSave.originalName}
                </p>
                <p className="text-xs text-orange-200/70">
                  Uploaded by {latestSave.uploadedByDisplayName}
                </p>
                <p className="text-xs text-orange-200/60">
                  <LatestSaveTimestamp timestamp={latestSave.uploadedAt} />
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-orange-200/70">
                No save has been uploaded for this campaign yet.
              </p>
            )}
          </div>

          {latestSave && canDownloadLatestSave ? (
            <DownloadSaveButton
              className="inline-flex min-h-10 items-center justify-center rounded border border-orange-400/60 bg-orange-400/10 px-4 py-2 text-sm font-mono font-semibold text-orange-200 transition hover:bg-orange-400 hover:text-black"
              fileName={latestSave.originalName}
              href={`/api/games/${gameNumber}/files/${latestSave.id}`}
            />
          ) : null}

          {canUpload ? (
            <UploadSaveForm gameNumber={gameNumber} presentation="compact" />
          ) : null}
        </div>
      </div>
    </section>
  );
}
