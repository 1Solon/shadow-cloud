"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TerminalActionConfirmationDialog } from "@/components/terminal-action-confirmation-dialog";
import { Button } from "@/components/ui/button";
import type { SaveRejectionLabel } from "@/lib/save-rejection";

type RejectSaveActionProps = {
  saveBaseline?: string;
  gameNumber: number;
  fileVersionId: string;
  fileName: string;
  uploaderDisplayName: string;
  label: SaveRejectionLabel;
};

export function RejectSaveAction({
  saveBaseline,
  gameNumber,
  fileVersionId,
  fileName,
  uploaderDisplayName,
  label,
}: RejectSaveActionProps) {
  const router = useRouter();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationBaseline, setConfirmationBaseline] =
    useState(saveBaseline);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openConfirmation() {
    setConfirmationBaseline(saveBaseline);
    setErrorMessage(null);
    setConfirmationOpen(true);
  }

  function rejectSave() {
    startTransition(async () => {
      const response = await fetch(
        `/api/games/${encodeURIComponent(String(gameNumber))}/files/${encodeURIComponent(fileVersionId)}/reject`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedSaveBaseline: confirmationBaseline }),
        },
      ).catch(() => null);

      if (!response) {
        setErrorMessage(
          "The save rejection request failed before reaching the server.",
        );
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setErrorMessage(payload?.error ?? "The save rejection failed.");
        return;
      }

      setErrorMessage(null);
      setConfirmationOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <TerminalActionConfirmationDialog
        confirmation={
          confirmationOpen
            ? {
                title: `${label} latest save`,
                command: `save --${label.toLowerCase()} ${fileName}`,
                lines: [
                  `${fileName} will be discarded.`,
                  `The turn returns to ${uploaderDisplayName}, and their turn time continues.`,
                ],
                confirmLabel: `${label} save`,
              }
            : null
        }
        isPending={isPending}
        onCancel={() => {
          setErrorMessage(null);
          setConfirmationOpen(false);
        }}
        onConfirm={rejectSave}
      >
        {errorMessage ? (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {errorMessage}
          </div>
        ) : null}
      </TerminalActionConfirmationDialog>
      <Button
        className="min-h-11 shrink-0 px-3 text-xs font-medium"
        type="button"
        variant="destructive"
        onClick={openConfirmation}
      >
        {label}
      </Button>
    </>
  );
}
