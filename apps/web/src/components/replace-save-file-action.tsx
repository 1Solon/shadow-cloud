"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TerminalActionConfirmationDialog } from "@/components/terminal-action-confirmation-dialog";

type ReplaceSaveFileActionProps = {
  gameNumber: number;
  fileVersionId: string;
  canonicalFileName: string;
  isMostRecent: boolean;
};

export function ReplaceSaveFileAction({
  gameNumber,
  fileVersionId,
  canonicalFileName,
  isMostRecent,
}: ReplaceSaveFileActionProps) {
  const router = useRouter();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetConfirmation() {
    setSelectedFile(null);
    setErrorMessage(null);
    setConfirmationOpen(false);
  }

  function openConfirmation() {
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
          <label className="block space-y-2">
            <span className="block text-xs uppercase tracking-[0.18em] text-orange-300">
              Replacement save file
            </span>
            <input
              accept=".se1"
              className="block w-full rounded-md border border-orange-400/40 bg-black/50 px-3 py-2 text-sm text-orange-200 file:mr-3 file:border-0 file:bg-orange-400 file:px-3 file:py-1 file:font-mono file:text-xs file:font-bold file:text-black"
              type="file"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                setErrorMessage(null);
              }}
            />
          </label>
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
      <button
        className={`inline-flex h-9 items-center rounded-md border px-3 text-xs font-medium uppercase tracking-[0.18em] font-mono transition-colors ${isMostRecent ? "border-black bg-black/10 text-black hover:bg-black hover:text-orange-400" : "border-orange-400 bg-orange-400/10 text-orange-300 hover:bg-orange-400 hover:text-black"}`}
        type="button"
        onClick={openConfirmation}
      >
        Replace
      </button>
    </>
  );
}
