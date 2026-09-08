"use client";

import { useState } from "react";
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
    <div className="space-y-3 border-t border-orange-400/30 pt-4">
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
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={pending}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Restore the previous password for {undo.regimeName}.
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="border border-orange-400 px-3 py-2"
            disabled={pending}
            onClick={() => {
              setConfirmed(false);
              onCancel();
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="border border-orange-400 px-3 py-2 disabled:opacity-50"
            disabled={pending || !confirmed}
          >
            {pending ? "Restoring save..." : "Undo password reset"}
          </button>
        </div>
      </form>
    </div>
  );
}
