"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Recovery = {
  resetId: string;
  outputId: string;
  outputRevision: number;
  expectedSaveBaseline: string;
  regimeName: string;
};

export function SavePasswordUndo({
  gameNumber,
  onSuccess,
}: {
  gameNumber: number;
  onSuccess: (name: string) => void;
}) {
  const router = useRouter();
  const [undo, setUndo] = useState<Recovery | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function check() {
    setUndo(null);
    setConfirmed(false);
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/games/${gameNumber}/password-reset`,
          { cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error ?? "Recovery is unavailable. Try again.");
          return;
        }
        setUndo(payload.undo);
        if (!payload.undo)
          setMessage("No password reset is available to undo.");
      } catch {
        setError("Recovery could not be checked. Try again.");
      }
    });
  }
  return (
    <div className="space-y-3 border-t border-orange-400/30 pt-4">
      <button
        type="button"
        className="border border-orange-400 px-3 py-2 disabled:opacity-50"
        disabled={pending}
        onClick={check}
      >
        Check undo availability
      </button>
      {undo ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!confirmed || pending) return;
            setError(null);
            startTransition(async () => {
              try {
                const response = await fetch(
                  `/api/games/${gameNumber}/password-reset/undo`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    cache: "no-store",
                    body: JSON.stringify({
                      resetId: undo.resetId,
                      outputId: undo.outputId,
                      outputRevision: undo.outputRevision,
                      expectedSaveBaseline: undo.expectedSaveBaseline,
                      confirmed: true,
                    }),
                  },
                );
                const payload = await response.json();
                if (!response.ok) {
                  setError(
                    payload.error ?? "Undo failed. Check recovery again.",
                  );
                  return;
                }
                onSuccess(undo.regimeName);
                router.refresh();
              } catch {
                setError(
                  "The request could not be confirmed. Refresh the campaign before trying again.",
                );
              } finally {
                setUndo(null);
                setConfirmed(false);
              }
            });
          }}
        >
          <p className="break-words">
            The previous password for {undo.regimeName} will be restored. It
            will not be shown.
          </p>
          <p>
            The turn will not advance. Players must download the updated save
            and restart any turn already begun from the previous copy.
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
                setUndo(null);
                setConfirmed(false);
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
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
