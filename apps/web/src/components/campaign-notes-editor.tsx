"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CampaignEditorStateProps } from "@/components/campaign-configuration-shell";
import {
  TerminalConfirmationModal,
  type TerminalConfirmationSpec,
} from "@/components/terminal-confirmation-modal";
import { Button } from "@/components/ui/button";

type CampaignNotesEditorProps = CampaignEditorStateProps & {
  gameNumber: number;
  notes: string | null;
};

type DirtyReport = {
  callback: CampaignEditorStateProps["onDirtyChange"];
  value: boolean;
};

export function CampaignNotesEditor({
  gameNumber,
  notes,
  onDirtyChange,
}: CampaignNotesEditorProps) {
  const router = useRouter();
  const authoritativeNotes = notes ?? "";
  const [draftNotes, setDraftNotes] = useState(authoritativeNotes);
  const [committedNotes, setCommittedNotes] = useState(authoritativeNotes);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<TerminalConfirmationSpec | null>(null);
  const [isPending, setIsPending] = useState(false);
  const latestAuthoritativeNotesRef = useRef(authoritativeNotes);
  const lastPropNotesRef = useRef(authoritativeNotes);
  const lastDirtyReportRef = useRef<DirtyReport | null>(null);
  const isDirty = draftNotes !== committedNotes;

  useEffect(() => {
    const lastReport = lastDirtyReportRef.current;
    if (
      lastReport?.callback === onDirtyChange &&
      lastReport.value === isDirty
    ) {
      return;
    }

    lastDirtyReportRef.current = { callback: onDirtyChange, value: isDirty };
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (lastPropNotesRef.current === authoritativeNotes) {
      return;
    }

    lastPropNotesRef.current = authoritativeNotes;
    latestAuthoritativeNotesRef.current = authoritativeNotes;
    // Prop reconciliation keeps clean drafts current without discarding dirty edits.
    setCommittedNotes(authoritativeNotes);
    if (!isDirty) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftNotes(authoritativeNotes);
    }
  }, [authoritativeNotes, isDirty]);

  function cancelEditing() {
    const latestAuthoritativeNotes = latestAuthoritativeNotesRef.current;
    setDraftNotes(latestAuthoritativeNotes);
    setCommittedNotes(latestAuthoritativeNotes);
    setErrorMessage(null);
    setConfirmation(null);
  }

  async function saveNotes() {
    setErrorMessage(null);
    setConfirmation(null);

    if (!isDirty) {
      setErrorMessage("Change the campaign notes before saving.");
      return;
    }

    setIsPending(true);

    try {
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

      latestAuthoritativeNotesRef.current = draftNotes;
      setCommittedNotes(draftNotes);
      setDraftNotes(draftNotes);
      lastDirtyReportRef.current = { callback: onDirtyChange, value: false };
      onDirtyChange(false);
      setConfirmation({
        command: "game-notes --commit",
        lines: [
          "[ok] operator notes written to the campaign ledger",
          "[ok] note cache refreshed for connected terminals",
          "<GAME NOTES UPDATED>",
        ],
      });
      router.refresh();
    } catch {
      setErrorMessage("The notes update failed.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <section
      data-testid="campaign-notes-editor"
      className="flex min-w-0 flex-col gap-4 border-l border-orange-400/30 pl-4 font-mono text-orange-200"
    >
      <TerminalConfirmationModal
        confirmation={confirmation}
        onClose={() => {
          setConfirmation(null);
        }}
      />

      <div className="flex min-w-0 flex-col gap-2">
        <label
          htmlFor="campaign-notes"
          className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-300"
        >
          Campaign notes
        </label>
        <textarea
          id="campaign-notes"
          disabled={isPending}
          className="min-h-48 min-w-0 w-full resize-y border border-orange-400/30 bg-black px-3 py-3 text-sm text-orange-200 outline-none transition-colors focus:border-orange-300 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          value={draftNotes}
          onChange={(event) => {
            setDraftNotes(event.target.value);
          }}
        />
        <p className="text-xs leading-relaxed text-orange-300/70">
          Markdown is supported. Links render in the notes view; raw HTML and
          images are ignored.
        </p>
      </div>

      {errorMessage ? (
        <p
          role="alert"
          className="border-l-2 border-red-400/60 px-3 py-2 text-sm text-red-300"
        >
          {errorMessage}
        </p>
      ) : null}

      <div
        data-testid="campaign-notes-actions"
        className="flex min-w-0 flex-wrap gap-2"
      >
        <Button
          disabled={isPending}
          type="button"
          variant="secondary"
          onClick={cancelEditing}
        >
          Cancel
        </Button>
        <Button disabled={isPending} type="button" onClick={saveNotes}>
          {isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </section>
  );
}
