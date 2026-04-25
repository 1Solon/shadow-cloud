"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  TerminalActionConfirmationDialog,
  type TerminalActionConfirmationSpec,
} from "@/components/terminal-action-confirmation-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AdministratorActionsCardProps = {
  gameNumber: number;
  gameName: string;
};

export function AdministratorActionsCard({
  gameNumber,
  gameName,
}: AdministratorActionsCardProps) {
  const router = useRouter();
  const [confirmation, setConfirmation] =
    useState<TerminalActionConfirmationSpec | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function requestDeleteCampaign() {
    setErrorMessage(null);
    setConfirmation({
      title: "Confirm campaign deletion",
      command: `campaign --delete ${gameNumber}`,
      lines: [
        `Campaign ${gameNumber}: ${gameName} will be permanently removed.`,
        "Uploaded saves linked to this campaign will also be deleted.",
      ],
      confirmLabel: "Delete",
    });
  }

  function deleteCampaign() {
    startTransition(async () => {
      const response = await fetch(`/api/games/${gameNumber}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setErrorMessage(body?.error ?? "The game delete failed.");
        return;
      }

      setConfirmation(null);
      router.push("/?deleted=success");
      router.refresh();
    });
  }

  return (
    <Card>
      <TerminalActionConfirmationDialog
        confirmation={confirmation}
        isPending={isPending}
        onCancel={() => {
          setConfirmation(null);
        }}
        onConfirm={deleteCampaign}
      />
      <CardHeader>
        <CardTitle>Administrator Actions:</CardTitle>
        <CardDescription>
          Elevated tools available only while Override is active.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage ? (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm font-mono text-red-300">
            {errorMessage}
          </div>
        ) : null}
        <Button
          className="w-full"
          disabled={isPending}
          type="button"
          variant="secondary"
          onClick={requestDeleteCampaign}
        >
          {isPending ? "Deleting..." : "Delete Campaign"}
        </Button>
      </CardContent>
    </Card>
  );
}