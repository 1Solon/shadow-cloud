"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  TerminalActionConfirmationDialog,
  type TerminalActionConfirmationSpec,
} from "@/components/terminal-action-confirmation-dialog";
import { Button } from "@/components/ui/button";

type ShadowOverrideButtonProps = {
  enabled: boolean;
};

export function ShadowOverrideButton({ enabled }: ShadowOverrideButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmation, setConfirmation] =
    useState<TerminalActionConfirmationSpec | null>(null);

  function openOverrideConfirmation() {
    const nextEnabled = !enabled;

    setConfirmation({
      title: "Confirm override change",
      command: nextEnabled
        ? "shadow-override --enable"
        : "shadow-override --disable",
      lines: [
        nextEnabled
          ? "Privileged campaign controls will become visible for this session."
          : "Privileged campaign controls will be hidden for this session.",
      ],
      confirmLabel: nextEnabled ? "Enable" : "Disable",
    });
  }

  function confirmOverrideChange() {
    const nextEnabled = !enabled;

    startTransition(async () => {
      await fetch("/api/shadow-override", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: nextEnabled,
        }),
      });

      setConfirmation(null);
      router.refresh();
    });
  }

  return (
    <>
      <TerminalActionConfirmationDialog
        confirmation={confirmation}
        isPending={isPending}
        onCancel={() => {
          setConfirmation(null);
        }}
        onConfirm={confirmOverrideChange}
      />
      <Button
        className="uppercase tracking-[0.18em]"
        disabled={isPending}
        size="sm"
        type="button"
        variant={enabled ? "destructive" : "outline"}
        onClick={openOverrideConfirmation}
      >
        {isPending ? "Switching..." : enabled ? "Override Armed" : "Override"}
      </Button>
    </>
  );
}
