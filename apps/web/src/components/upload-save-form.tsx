"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { fieldLabel, fieldValue } from "@/lib/terminal-styles";

type UploadSaveFormProps = {
  saveBaseline?: string;
  gameNumber: number;
  presentation?: "standard" | "compact";
};

export type UploadSaveFormHandle = {
  selectFile: (file: File) => void;
};

export const UploadSaveForm = forwardRef<
  UploadSaveFormHandle,
  UploadSaveFormProps
>(function UploadSaveForm(
  { saveBaseline, gameNumber, presentation = "standard" },
  ref,
) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedBaseline, setSelectedBaseline] = useState(saveBaseline);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isCompact = presentation === "compact";

  function handleFile(file: File | undefined) {
    setSelectedBaseline(saveBaseline);
    setSelectedFile(file ?? null);
    setErrorMessage(null);
  }

  useImperativeHandle(ref, () => ({
    selectFile: handleFile,
  }));

  function clearFile() {
    setSelectedFile(null);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <form
      className={isCompact ? "flex h-full flex-col" : undefined}
      onSubmit={(event) => {
        event.preventDefault();

        if (!selectedFile) {
          setErrorMessage("Choose a save file to upload.");
          return;
        }

        const formData = new FormData();
        formData.set("file", selectedFile, selectedFile.name);
        formData.set("expectedSaveBaseline", selectedBaseline ?? "");
        setErrorMessage(null);

        startTransition(async () => {
          const response = await fetch(
            `/api/games/${encodeURIComponent(String(gameNumber))}/files`,
            {
              method: "POST",
              body: formData,
            },
          ).catch(() => null);

          if (!response) {
            setErrorMessage(
              "The save upload request failed before reaching the server.",
            );
            return;
          }

          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as {
              error?: string;
            } | null;
            setErrorMessage(payload?.error ?? "The save upload failed.");
            return;
          }

          const payload = (await response.json().catch(() => null)) as {
            redirectTo?: string;
          } | null;

          if (payload?.redirectTo) {
            clearFile();
            router.replace(payload.redirectTo, { scroll: false });
            router.refresh();
            return;
          }

          clearFile();
          router.refresh();
        });
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".se1"
        aria-label="Save file"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label={
          selectedFile
            ? `Selected save file ${selectedFile.name}`
            : isCompact
              ? "Download the latest save above. When you’ve finished your turn, click here or drag and drop your new save for the next Lord."
              : "Drop save files here"
        }
        className={[
          "rounded-md border border-dashed transition-colors cursor-pointer",
          isCompact
            ? "flex flex-1 flex-col justify-center px-4 py-6 text-left"
            : "px-8 py-14 text-center",
          isDragOver
            ? "border-terminal-400/30 bg-terminal-400/15"
            : "border-terminal-400/30 bg-terminal-400/5 hover:bg-terminal-400/10",
        ].join(" ")}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        {/* Upload icon */}
        {selectedFile ? (
          <>
            <div
              className={[
                `mb-1 font-mono uppercase ${fieldValue}`,
                isCompact ? "min-w-0 [overflow-wrap:anywhere]" : "",
              ].join(" ")}
            >
              <span aria-hidden="true">&gt; </span>
              {selectedFile.name}
            </div>
            <div className="font-mono text-xs text-terminal-300/70">
              {`${(selectedFile.size / 1024 / 1024).toFixed(2)} MB · Click or drag to replace`}
            </div>
          </>
        ) : isCompact ? (
          <div className={`font-mono ${fieldValue}`}>
            <span aria-hidden="true">&gt; </span>
            Download the latest save above. When you’ve finished your turn,
            click here or drag and drop your new save for the next Lord.
          </div>
        ) : (
          <>
            <div className={`mb-2 font-mono uppercase ${fieldValue}`}>
              <span aria-hidden="true">&gt; </span>
              DROP SAVE FILES HERE
            </div>
            <div className="mb-6 font-mono text-xs text-terminal-300/70">
              Drag and drop your .se1 save files here
            </div>
            <span className={buttonVariants({ className: "animate-pulse" })}>
              <span aria-hidden="true">&gt; </span>
              SELECT FILES
            </span>
          </>
        )}
      </div>

      {/* Error banner */}
      {errorMessage ? (
        <p className="mt-4 font-mono text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}

      {/* Submit row — only when a file is staged */}
      {selectedFile ? (
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-4">
          <Button
            className={
              isCompact
                ? "max-w-full whitespace-normal h-auto min-h-11 px-4 py-3 text-center"
                : undefined
            }
            disabled={isPending}
            size="lg"
            type="submit"
          >
            {isPending ? "Uploading..." : "Upload save and advance turn"}
          </Button>
          <Button
            className="h-auto p-0"
            type="button"
            variant="ghost"
            onClick={clearFile}
          >
            Clear
          </Button>
        </div>
      ) : null}

      {/* Instructions panel */}
      {!isCompact ? (
        <div className="mt-6 rounded-md border border-terminal-400/20 bg-terminal-400/5 px-5 py-4">
          <div className={`mb-3 font-mono ${fieldLabel}`}>
            Upload instructions
          </div>
          <ul className="space-y-1.5 font-mono text-xs text-terminal-300/70">
            <li>· Supported formats: .se1</li>
            <li>· Maximum file size: 25MB per file</li>
            <li>
              · Uploading advances the seat order and notifies the next lord
            </li>
            <li>· Only the active lord can submit a save</li>
          </ul>
        </div>
      ) : null}
    </form>
  );
});
