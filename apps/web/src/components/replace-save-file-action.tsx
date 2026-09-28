"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TerminalActionConfirmationDialog } from "@/components/terminal-action-confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ReplaceSaveFileActionProps = {
  saveBaseline?: string;
  gameNumber: number;
  fileVersionId: string;
  canonicalFileName: string;
  isMostRecent: boolean;
};

export function ReplaceSaveFileAction({
  saveBaseline,
  gameNumber,
  fileVersionId,
  canonicalFileName,
  isMostRecent,
}: ReplaceSaveFileActionProps) {
  const router = useRouter();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationBaseline, setConfirmationBaseline] =
    useState(saveBaseline);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetConfirmation() {
    setSelectedFile(null);
    setErrorMessage(null);
    setConfirmationOpen(false);
  }

  function openConfirmation() {
    setConfirmationBaseline(saveBaseline);
    setSelectedFile(null);
    setErrorMessage(null);
    setConfirmationOpen(true);
  }

  function replaceFile() {
    if (!selectedFile) {
      return;
    }

    const formData = new FormData();
    formData.set("file", selectedFile, selectedFile.name);
    formData.set("expectedSaveBaseline", confirmationBaseline ?? "");

    startTransition(async () => {
      const response = await fetch(
        `/api/games/${encodeURIComponent(String(gameNumber))}/files/${encodeURIComponent(fileVersionId)}`,
        { method: "PUT", body: formData },
      ).catch(() => null);

      if (!response) {
        setErrorMessage(
          "The save replacement request failed before reaching the server.",
        );
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setErrorMessage(payload?.error ?? "The save replacement failed.");
        return;
      }

      setSelectedFile(null);
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
                title: "Replace save file",
                command: `save --replace ${canonicalFileName}`,
                lines: [
                  "Choose a corrected save file to replace this version.",
                ],
                confirmLabel: "Replace file",
              }
            : null
        }
        confirmDisabled={!selectedFile}
        isPending={isPending}
        onCancel={resetConfirmation}
        onConfirm={replaceFile}
      >
        <div className="space-y-3 border-t border-orange-400/20 pt-4 text-sm text-orange-300/80">
          <p>
            Replacing{" "}
            <span className="text-orange-200">{canonicalFileName}</span>
          </p>
          <Label className="block space-y-2">
            <span className="block text-xs uppercase tracking-[0.18em] text-terminal-300">
              Replacement save file
            </span>
            <Input
              accept=".se1"
              className="h-auto py-2"
              type="file"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                setErrorMessage(null);
              }}
            />
          </Label>
          {selectedFile ? (
            <p className="text-xs text-orange-300/70">
              Selected: {selectedFile.name}
            </p>
          ) : null}
          <p className="text-xs text-orange-300/70">Maximum file size: 25 MB</p>
          <p className="text-xs text-orange-300/70">
            Replacing this file will not advance the turn.
          </p>
          {errorMessage ? (
            <div
              className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300"
              role="alert"
            >
              {errorMessage}
            </div>
          ) : null}
        </div>
      </TerminalActionConfirmationDialog>
      <Button
        className={cn(
          "min-h-11 px-3 text-xs uppercase tracking-[0.14em]",
          isMostRecent && "bg-terminal-400/10",
        )}
        type="button"
        variant="outline"
        onClick={openConfirmation}
      >
        Replace
      </Button>
    </>
  );
}
