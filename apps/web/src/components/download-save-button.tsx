"use client";

import { useState } from "react";
import {
  TerminalConfirmationModal,
  type TerminalConfirmationSpec,
} from "@/components/terminal-confirmation-modal";

type DownloadSaveButtonProps = {
  className: string;
  fileName: string;
  href: string;
};

export function DownloadSaveButton({
  className,
  fileName,
  href,
}: DownloadSaveButtonProps) {
  const [confirmation, setConfirmation] =
    useState<TerminalConfirmationSpec | null>(null);

  return (
    <>
      <TerminalConfirmationModal
        confirmation={confirmation}
        onClose={() => {
          setConfirmation(null);
        }}
      />
      <button
        className={className}
        type="button"
        onClick={() => {
          setConfirmation({
            command: "save-download --dispatch",
            lines: [
              `[ok] preparing ${fileName} for local transfer`,
              "[ok] browser handoff accepted for secure file download",
              "<SAVE FILE DOWNLOADING>",
            ],
          });

          const anchor = document.createElement("a");
          anchor.href = href;
          anchor.rel = "noopener";
          anchor.style.display = "none";
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
        }}
      >
        Download
      </button>
    </>
  );
}
