"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  TerminalActionConfirmationDialog,
  type TerminalActionConfirmationSpec,
} from "@/components/terminal-action-confirmation-dialog";

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
      <button
        type="button"
        disabled={isPending}
        onClick={openOverrideConfirmation}
        className={`inline-flex h-8 items-center rounded-md border px-3 text-xs font-mono uppercase tracking-[0.18em] transition-colors ${enabled ? "border-red-400/70 bg-red-400/10 text-red-300 hover:bg-red-400 hover:text-black" : "border-orange-400/60 bg-transparent text-orange-400/80 hover:bg-orange-400 hover:text-black"}`}
      >
        {isPending ? "Switching..." : enabled ? "Override Armed" : "Override"}
      </button>
    </>
  );
}
