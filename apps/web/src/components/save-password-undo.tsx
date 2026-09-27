"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { PasswordRecovery } from "@/lib/save-inspection";

export function SavePasswordUndo({
  undo,
  pending,
  onUndo,
  onCancel,
}: {
  undo: PasswordRecovery;
  pending: boolean;
  onUndo: () => Promise<void>;
  onCancel: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="space-y-3 border-t border-terminal-400/30 pt-4">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmed || pending) return;
          void onUndo();
          setConfirmed(false);
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
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setConfirmed(false);
              onCancel();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !confirmed}>
            {pending ? "Restoring save..." : "Undo password reset"}
          </Button>
        </div>
      </form>
    </div>
  );
}
