"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { DownloadSaveButton } from "@/components/download-save-button";
import { GameNotesMarkdown } from "@/components/game-notes-markdown";
import { RejectSaveAction } from "@/components/reject-save-action";
import {
  UploadSaveForm,
  type UploadSaveFormHandle,
} from "@/components/upload-save-form";
import type { SaveRejectionLabel } from "@/lib/save-rejection";
import { fieldLabel, fieldValue, padNumber } from "@/lib/terminal-styles";
import {
  formatTurnDuration,
  getTurnDurationMs,
  normalizeTurnTargetHours,
} from "@/lib/turn-timing";

export type TurnCommandCenterProps = {
  saveBaseline?: string;
  activePlayerDisplayName: string;
  activeSeatNumber: number | null;
  currentTurnStartedAt: string | null;
  gameNumber: number;
  initialNow: string;
  isActivePlayer: boolean;
  isSignedIn: boolean;
  latestSave: {
    contentRevision: number;
    id: string;
    originalName: string;
    uploadedByDisplayName: string;
  } | null;
  notes: string;
  roundNumber: number;
  saveRejectionLabel?: SaveRejectionLabel | null;
  turnTargetHours: number;
};

const refreshIntervalMs = 60 * 1000;
const lengthyNotesCharacterCount = 240;
const rail = {
  yours: "border-l-terminal-400",
  overdue: "border-l-destructive",
  waiting: "border-l-terminal-400/40",
};
const spokenState = {
  yours: "It is your turn.",
  overdue: "This turn is overdue.",
  waiting: "Waiting for the active lord.",
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className={fieldLabel}>{label}</dt>
      <dd className={`mt-1 truncate tabular-nums ${fieldValue}`}>{value}</dd>
    </div>
  );
}

function containsFiles(event: DragEvent<HTMLElement>) {
  return (
    event.dataTransfer.files.length > 0 ||
    Array.from(event.dataTransfer.types).includes("Files")
  );
}

export function TurnCommandCenter({
  saveBaseline,
  activePlayerDisplayName,
  activeSeatNumber,
  currentTurnStartedAt,
  gameNumber,
  initialNow,
  isActivePlayer,
  isSignedIn,
  latestSave,
  notes,
  roundNumber,
  saveRejectionLabel,
  turnTargetHours,
}: TurnCommandCenterProps) {
  const headingId = useId();
  const uploadFormRef = useRef<UploadSaveFormHandle>(null);
  const [now, setNow] = useState(() => new Date(initialNow));
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(
    notes.trim().length <= lengthyNotesCharacterCount,
  );
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
  const targetHours = normalizeTurnTargetHours(turnTargetHours);
  const target = targetHours !== null ? `${targetHours}h` : "Unknown";
  const canUpload = isSignedIn && isActivePlayer;
  const isOverdue =
    elapsedMs !== null &&
    targetHours !== null &&
    elapsedMs > targetHours * 3_600_000;
  const state = canUpload ? "yours" : isOverdue ? "overdue" : "waiting";
  const hasNotes = notes.trim().length > 0;
  const latestSaveCard = latestSave ? (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border border-terminal-400/20 bg-terminal-400/5 px-3 py-2.5">
      <div className="min-w-0">
        <p className={fieldLabel}>Latest save</p>
        <p
          className={`mt-1 truncate ${fieldValue}`}
          title={latestSave.originalName}
        >
          {latestSave.originalName}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <DownloadSaveButton
          className="min-h-11 shrink-0 px-3"
          fileName={latestSave.originalName}
          href={`/api/games/${gameNumber}/files/${latestSave.id}?revision=${latestSave.contentRevision}`}
          label="Download latest save"
          variant="outline"
        />
        {saveRejectionLabel ? (
          <RejectSaveAction
            fileName={latestSave.originalName}
            fileVersionId={latestSave.id}
            gameNumber={gameNumber}
            label={saveRejectionLabel}
            saveBaseline={saveBaseline}
            uploaderDisplayName={latestSave.uploadedByDisplayName}
          />
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <section
      aria-labelledby={headingId}
      className={`overflow-hidden rounded-lg border border-l-[6px] border-terminal-400/20 font-mono text-terminal-300 ${rail[state]}`}
      onDragOver={(event) => {
        if (!event.defaultPrevented && containsFiles(event)) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (event.defaultPrevented || !containsFiles(event)) {
          return;
        }

        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (!file) {
          return;
        }

        if (canUpload) {
          setDropNotice(null);
          uploadFormRef.current?.selectFile(file);
          return;
        }

        setDropNotice(
          isSignedIn
            ? `It is currently ${activePlayerDisplayName}’s turn. Only the active lord can upload this save.`
            : `Sign in with the Discord account for ${activePlayerDisplayName} to upload this save.`,
        );
      }}
    >
      <h2 className="sr-only" id={headingId}>
        Current turn
      </h2>
      <p className="sr-only">{spokenState[state]}</p>
      <div
        className={
          canUpload
            ? "grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
            : "p-3 sm:p-4"
        }
        data-testid="command-center-body"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <dl
            className={`grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 ${canUpload ? "lg:grid-cols-2" : ""}`}
          >
            <Metric label="Active lord" value={activePlayerDisplayName} />
            <Metric
              label="Seat"
              value={
                activeSeatNumber === null
                  ? "Seat unknown"
                  : `Seat ${activeSeatNumber}`
              }
            />
            <Metric label="Round" value={padNumber(roundNumber)} />
            <Metric label="Elapsed / target" value={`${elapsed} / ${target}`} />
          </dl>

          {canUpload ? null : latestSaveCard}

          <details
            className="group border-t border-terminal-400/20 pt-1"
            data-testid="campaign-notes"
            open={notesOpen}
            onToggle={(event) => setNotesOpen(event.currentTarget.open)}
          >
            <summary
              className={`flex cursor-pointer list-none items-center justify-between gap-4 py-2 ${fieldLabel} transition-colors hover:text-terminal-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden`}
            >
              <span>Campaign notes</span>
              <span className="shrink-0">
                {notesOpen ? "Hide −" : "Show +"}
              </span>
            </summary>
            <div className="pb-1">
              {hasNotes ? (
                <GameNotesMarkdown
                  content={notes}
                  className="rounded-none border-0 bg-transparent px-0 py-0"
                />
              ) : (
                <p className="text-sm leading-6 text-terminal-300/70">
                  No campaign notes recorded.
                </p>
              )}
            </div>
          </details>
        </div>

        {canUpload ? (
          <div className="flex min-h-0 flex-col gap-3 border-t border-terminal-400/20 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            {latestSaveCard}
            <div className="min-h-0 flex-1">
              <UploadSaveForm
                gameNumber={gameNumber}
                ref={uploadFormRef}
                saveBaseline={saveBaseline}
                presentation="compact"
              />
            </div>
          </div>
        ) : null}
      </div>
      {dropNotice ? (
        <p
          className="border-t border-terminal-400/20 bg-terminal-400/10 px-3 py-2.5 text-sm text-terminal-300 sm:px-4"
          role="status"
        >
          {dropNotice}
        </p>
      ) : null}
    </section>
  );
}
