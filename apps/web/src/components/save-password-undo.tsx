"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const mountedRef = useRef(false);
  const currentGameNumberRef = useRef(gameNumber);
  const postPendingRef = useRef(false);
  const postControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      postControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    currentGameNumberRef.current = gameNumber;
    if (postPendingRef.current) return;

    const controller = new AbortController();
    let ignored = false;
    setUndo(null);
    setConfirmed(false);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/games/${gameNumber}/password-reset`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = await response.json();
        if (ignored || controller.signal.aborted || !mountedRef.current) return;
        if (!response.ok) {
          setError(
            payload.error ??
              "Recovery is unavailable. Refresh the campaign and try again.",
          );
          return;
        }
        setUndo(payload.undo ?? null);
      } catch {
        if (ignored || controller.signal.aborted || !mountedRef.current) return;
        setError(
          "Recovery is unavailable. Refresh the campaign and try again.",
        );
      }
    });

    return () => {
      ignored = true;
      controller.abort();
    };
  }, [availabilityVersion, gameNumber]);

  if (!undo && !error) return null;

  return (
    <div className="space-y-3 border-t border-orange-400/30 pt-4">
      {undo ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!confirmed || pending || postPendingRef.current) return;
            setError(null);
            const recovery = undo;
            const requestGameNumber = gameNumber;
            const controller = new AbortController();
            postPendingRef.current = true;
            postControllerRef.current = controller;
            startTransition(async () => {
              try {
                const response = await fetch(
                  `/api/games/${requestGameNumber}/password-reset/undo`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    cache: "no-store",
                    signal: controller.signal,
                    body: JSON.stringify({
                      resetId: recovery.resetId,
                      outputId: recovery.outputId,
                      outputRevision: recovery.outputRevision,
                      expectedSaveBaseline: recovery.expectedSaveBaseline,
                      confirmed: true,
                    }),
                  },
                );
                const payload = await response.json();
                if (
                  controller.signal.aborted ||
                  !mountedRef.current ||
                  currentGameNumberRef.current !== requestGameNumber
                )
                  return;
                if (!response.ok) {
                  setError(
                    payload.error ??
                      "Undo failed. Refresh the campaign and try again.",
                  );
                  return;
                }
                onSuccess(recovery.regimeName);
                router.refresh();
              } catch {
                if (
                  controller.signal.aborted ||
                  !mountedRef.current ||
                  currentGameNumberRef.current !== requestGameNumber
                )
                  return;
                setError(
                  "The request could not be confirmed. Refresh the campaign before trying again.",
                );
              } finally {
                postPendingRef.current = false;
                postControllerRef.current = null;
                if (!mountedRef.current) return;
                setUndo(null);
                setConfirmed(false);
                if (currentGameNumberRef.current !== requestGameNumber) {
                  setError(null);
                  setAvailabilityVersion((version) => version + 1);
                }
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
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
