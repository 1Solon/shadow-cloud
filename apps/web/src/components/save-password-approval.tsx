"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LocalTimestamp } from "@/components/local-timestamp";
import {
  isPasswordReceipt,
  isPasswordRecovery,
  type PasswordRecovery,
  type SaveInspection,
} from "@/lib/save-inspection";
import {
  approverRoleLabel,
  type PasswordResetApproval,
} from "@/lib/shadow-cloud-api";
import { fieldLabel, fieldValue } from "@/lib/terminal-styles";
import { SavePasswordReason, usePasswordReason } from "./save-password-reason";
import { SavePasswordReset } from "./save-password-reset";
import { SavePasswordUndo } from "./save-password-undo";

function errorMessage(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback;
}

function useApprovalRequest(gameNumber: number) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/games/${encodeURIComponent(String(gameNumber))}`;
  async function post(path: string, body: unknown, fallback: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${base}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorMessage(payload, fallback));
        return null;
      }
      router.refresh();
      return payload;
    } catch {
      setError(fallback);
      return null;
    } finally {
      setPending(false);
    }
  }
  return { base, pending, error, post };
}

export function SavePasswordApprovalPanel({
  approval,
  gameNumber,
}: {
  approval: PasswordResetApproval;
  gameNumber: number;
}) {
  const request = useApprovalRequest(gameNumber);
  return (
    <section
      aria-label="Password reset approval"
      className="space-y-2 rounded-md border border-terminal-400/20 bg-terminal-400/5 p-4"
    >
      <h3 className={fieldLabel}>Password reset approval</h3>
      <p>
        <span className={fieldValue}>{approval.playerDisplayName}</span> may set
        a new password for{" "}
        <span className={fieldValue}>{approval.regimeName}</span>.
      </p>
      <p className="text-xs text-terminal-300/70">
        Approved by {approval.approverDisplayName} (
        {approverRoleLabel[approval.approverRole]}){" "}
        <LocalTimestamp compact timestamp={approval.grantedAt} />
      </p>
      {approval.reason ? (
        <p className="text-xs text-terminal-300/70">{approval.reason}</p>
      ) : null}
      {request.error ? (
        <p role="alert" className="text-xs text-destructive">
          {request.error}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={request.pending}
        onClick={() =>
          void request.post(
            "password-reset-approval/withdraw",
            { approvalId: approval.id },
            "The withdrawal failed. Refresh the campaign and try again.",
          )
        }
      >
        {request.pending ? "Withdrawing..." : "Withdraw"}
      </Button>
    </section>
  );
}

export function GrantPasswordApproval({
  inspection,
  playerDisplayName,
  gameNumber,
  requiresReason,
  disabled,
}: {
  inspection: SaveInspection;
  playerDisplayName: string;
  gameNumber: number;
  requiresReason: boolean;
  disabled: boolean;
}) {
  const request = useApprovalRequest(gameNumber);
  const reason = usePasswordReason(requiresReason);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button
        className="max-w-full"
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Let {playerDisplayName} set it
      </Button>
    );
  return (
    <form
      className="space-y-3 rounded-md border border-terminal-400/20 bg-terminal-400/5 p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!reason.ready || request.pending) return;
        const result = await request.post(
          "password-reset-approval",
          {
            fileVersionId: inspection.fileVersionId,
            sourceId: inspection.sourceId,
            expectedSaveBaseline: inspection.expectedSaveBaseline,
            ...(reason.submitted ? { reason: reason.submitted } : {}),
          },
          "The approval failed. Inspect the latest save and try again.",
        );
        if (result) setOpen(false);
      }}
    >
      <p>
        {playerDisplayName} will be able to set a new in-game password for this
        regime once, without anyone else knowing it. The approval ends if the
        latest save changes first.
      </p>
      {requiresReason ? (
        <SavePasswordReason
          label="Reason for approving"
          value={reason.value}
          disabled={request.pending}
          onChange={reason.setValue}
        />
      ) : null}
      {request.error ? (
        <p role="alert" className="text-xs text-destructive">
          {request.error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={request.pending}
          onClick={() => {
            reason.clear();
            setOpen(false);
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={request.pending || !reason.ready}>
          {request.pending ? "Approving..." : "Approve"}
        </Button>
      </div>
    </form>
  );
}

export function ApprovedPasswordCard({
  approval,
  gameNumber,
  saveBaseline,
}: {
  approval: PasswordResetApproval;
  gameNumber: number;
  saveBaseline?: string;
}) {
  const request = useApprovalRequest(gameNumber);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<PasswordRecovery | null>(null);
  const regime = {
    id: approval.regimeId,
    name: approval.regimeName,
    current: true,
    eligible: true,
    reason: null,
  };

  useEffect(() => {
    if (approval.state !== "USED") return;
    const controller = new AbortController();
    void fetch(`${request.base}/password-reset`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (!controller.signal.aborted)
          setRecovery(isPasswordRecovery(payload) ? payload.undo : null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [approval.id, approval.state, request.base]);

  return (
    <Card
      className="min-w-0 overflow-hidden font-mono text-sm text-terminal-300"
      role="region"
      aria-label="In-game password"
    >
      <CardHeader>
        <CardTitle>Passwords</CardTitle>
        <CardDescription>
          {approval.state === "OPEN"
            ? `The ${approverRoleLabel[approval.approverRole]} approved you to set a new in-game password.`
            : "You set a new in-game password for the latest save."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <span className={`block break-words ${fieldValue}`}>
            {approval.regimeName}
          </span>
          <span className="block text-xs text-terminal-300/70">
            The save is waiting on this regime
          </span>
        </div>
        {request.error ? (
          <p role="alert" className="text-xs text-destructive">
            {request.error}
          </p>
        ) : null}
        {approval.state === "OPEN" && !editing ? (
          <Button
            type="button"
            variant="outline"
            disabled={request.pending}
            onClick={() => setEditing(true)}
          >
            Set password
          </Button>
        ) : null}
        {approval.state === "OPEN" && editing ? (
          <SavePasswordReset
            regime={regime}
            pending={request.pending}
            onCancel={() => setEditing(false)}
            onReset={async (password) => {
              const receipt = await request.post(
                "password-reset-approval/use",
                {
                  approvalId: approval.id,
                  expectedSaveBaseline: saveBaseline,
                  password,
                  confirmed: true,
                },
                "Setting the password failed. Refresh and try again.",
              );
              if (isPasswordReceipt(receipt)) {
                setEditing(false);
                setNotice(
                  `You set a new in-game password for ${receipt.regimeName}. The latest save has been replaced; the turn has not advanced. Download the updated save before continuing.`,
                );
              }
            }}
          />
        ) : null}
        {approval.state === "USED" && recovery ? (
          <SavePasswordUndo
            undo={recovery}
            pending={request.pending}
            onCancel={() => setRecovery(null)}
            onUndo={async () => {
              const receipt = await request.post(
                "password-reset/undo",
                {
                  resetId: recovery.resetId,
                  outputId: recovery.outputId,
                  outputRevision: recovery.outputRevision,
                  expectedSaveBaseline: recovery.expectedSaveBaseline,
                  confirmed: true,
                },
                "Undo failed. Refresh the campaign and try again.",
              );
              if (isPasswordReceipt(receipt)) {
                setRecovery(null);
                setNotice(
                  `The previous password for ${receipt.regimeName} was restored. Download the updated save before continuing.`,
                );
              }
            }}
          />
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
      </CardContent>
    </Card>
  );
}
