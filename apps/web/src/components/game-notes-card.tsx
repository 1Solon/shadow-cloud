"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  TerminalConfirmationModal,
  type TerminalConfirmationSpec,
} from "@/components/terminal-confirmation-modal";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GameNotesMarkdown } from "@/components/game-notes-markdown";

type GameNotesCardProps = {
  gameNumber: number;
  canEdit: boolean;
  notes: string | null;
};

export function GameNotesCard({
  gameNumber,
  canEdit,
  notes,
}: GameNotesCardProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draftNotes, setDraftNotes] = useState(notes ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<TerminalConfirmationSpec | null>(null);
  const [isPending, startTransition] = useTransition();

  function cancelEditing() {
    setDraftNotes(notes ?? "");
    setIsEditing(false);
    setErrorMessage(null);
    setConfirmation(null);
  }

  function saveNotes() {
    setErrorMessage(null);
    setConfirmation(null);

    startTransition(async () => {
      const response = await fetch(
        `/api/games/${encodeURIComponent(String(gameNumber))}/metadata`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            notes: draftNotes.trim() ? draftNotes : null,
          }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setErrorMessage(body?.error ?? "The notes update failed.");
        return;
      }

      setIsEditing(false);
      setConfirmation({
        command: "game-notes --commit",
        lines: [
          "[ok] operator notes written to the campaign ledger",
          "[ok] note cache refreshed for connected terminals",
          "<GAME NOTES UPDATED>",
        ],
      });
      router.refresh();
    });
  }

  return (
    <Card>
      <TerminalConfirmationModal
        confirmation={confirmation}
        onClose={() => {
          setConfirmation(null);
        }}
      />
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Notes:</CardTitle>
          <CardDescription>
            Strategy notes, conventions, and campaign reminders for this world.
          </CardDescription>
        </div>
        {canEdit ? (
          isEditing ? (
            <div className="flex gap-2">
              <Button
                disabled={isPending}
                type="button"
                variant="secondary"
                onClick={cancelEditing}
              >
                Cancel
              </Button>
              <Button disabled={isPending} type="button" onClick={saveNotes}>
                {isPending ? "Saving..." : "Save notes"}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDraftNotes(notes ?? "");
                setErrorMessage(null);
                setConfirmation(null);
                setIsEditing(true);
              }}
            >
              Edit
            </Button>
          )
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage ? (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm font-mono text-red-300">
            {errorMessage}
          </div>
        ) : null}

        {isEditing ? (
          <div className="space-y-2">
            <textarea
              className="min-h-40 w-full rounded-md border border-orange-400/30 bg-black px-3 py-3 text-sm font-mono text-orange-200 outline-none transition focus:border-orange-300"
              value={draftNotes}
              onChange={(event) => {
                setDraftNotes(event.target.value);
              }}
            />
            <p className="text-xs font-mono text-orange-300/70">
              Markdown is supported. Links render in the notes view; raw HTML
              and images are ignored.
            </p>
          </div>
        ) : (
          <>
            {notes?.trim() ? (
              <GameNotesMarkdown content={notes} />
            ) : (
              <div className="rounded-lg border border-orange-400/20 bg-orange-400/5 px-4 py-4 text-sm font-mono text-orange-200">
                No notes recorded for this world.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
