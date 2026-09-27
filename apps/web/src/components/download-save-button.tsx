"use client";

import { useState, type ComponentProps } from "react";
import {
  TerminalConfirmationModal,
  type TerminalConfirmationSpec,
} from "@/components/terminal-confirmation-modal";
import { Button } from "@/components/ui/button";

type DownloadSaveButtonProps = {
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  fileName: string;
  href: string;
  label?: string;
};

export function DownloadSaveButton({
  className,
  variant,
  fileName,
  href,
  label = "Download",
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
      <Button
        className={className}
        type="button"
        variant={variant}
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
        {label}
      </Button>
    </>
  );
}
