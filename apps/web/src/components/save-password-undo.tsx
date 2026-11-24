"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { PasswordRecovery } from "@/lib/save-inspection";
import { SavePasswordReason, usePasswordReason } from "./save-password-reason";

export function SavePasswordUndo({
  undo,
  pending,
  onUndo,
  onCancel,
  requiresReason = false,
}: {
  undo: PasswordRecovery;
  pending: boolean;
  onUndo: (reason?: string) => Promise<void>;
  onCancel: () => void;
  requiresReason?: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const reason = usePasswordReason(requiresReason);
  return (
    <div className="space-y-3 border-t border-terminal-400/20 pt-4 text-sm text-terminal-300">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmed || pending || !reason.ready) return;
          void onUndo(reason.submitted);
          setConfirmed(false);
          reason.clear();
        }}
      >
        <p className="break-words">
          The previous password for {undo.regimeName} will be restored. It will
          not be shown.
        </p>
        <p>
          The turn will not advance. Players must download the updated save and
          restart any turn already begun from the previous copy.
        </p>
        {requiresReason ? (
          <SavePasswordReason
            label="Reason for undoing"
            value={reason.value}
            disabled={pending}
            onChange={reason.setValue}
          />
        ) : null}
        <Label className="flex items-start gap-2">
          <Checkbox
            checked={confirmed}
            className="mt-1"
            disabled={pending}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
          />
          Restore the previous password for {undo.regimeName}.
        </Label>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setConfirmed(false);
              reason.clear();
              onCancel();
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={pending || !confirmed || !reason.ready}
          >
            {pending ? "Restoring save..." : "Undo password reset"}
          </Button>
        </div>
      </form>
    </div>
  );
}
