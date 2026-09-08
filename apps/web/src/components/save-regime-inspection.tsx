"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import type { SaveInspection } from "@/lib/save-inspection";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SavePasswordReset } from "./save-password-reset";
import { SavePasswordUndo } from "./save-password-undo";

export function SaveRegimeInspection({
  gameNumber,
  isOverlord,
  hasSave,
  saveRevision,
}: {
  gameNumber: number;
  isOverlord: boolean;
  hasSave: boolean;
  saveRevision?: string;
}) {
  const [success, setSuccess] = useState<{
    name: string;
    action: "reset" | "undo";
  } | null>(null);
  const clearSuccess = useCallback(() => setSuccess(null), []);
  if (!isOverlord) return null;
  return (
    <Card
      className="min-w-0 overflow-hidden font-mono text-sm text-orange-200"
      role="region"
      aria-label="In-game regime inspection"
    >
      <InspectionDraft
        key={saveRevision}
        gameNumber={gameNumber}
        hasSave={hasSave}
        onInspect={clearSuccess}
        onSuccess={(name, action) => setSuccess({ name, action })}
      />
      {success ? (
        <CardContent>
          <p role="status">
            {success.action === "reset"
              ? `The in-game password for ${success.name} was reset.`
              : `The previous password for ${success.name} was restored.`}{" "}
            The latest save has been replaced; the turn has not advanced.
            Download the updated save before continuing. If you already started
            from the previous copy, restart from the updated save.
            {success.action === "reset"
              ? " Share the replacement password privately."
              : null}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function InspectionDraft({
  gameNumber,
  hasSave,
  onInspect,
  onSuccess,
}: {
  gameNumber: number;
  hasSave: boolean;
  onInspect: () => void;
  onSuccess: (name: string, action: "reset" | "undo") => void;
}) {
  const [inspection, setInspection] = useState<SaveInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const [inspectionState, setInspectionState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [pending, startTransition] = useTransition();
  const inspectionControllerRef = useRef<AbortController | null>(null);
  const inspectionRequestRef = useRef(0);

  const inspect = useCallback((clearSuccess = true) => {
    inspectionControllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = inspectionRequestRef.current + 1;
    inspectionRequestRef.current = requestId;
    setInspection(null);
    setError(null);
    setSelected(null);
    setInspectionState("loading");
    if (clearSuccess) onInspect();
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/games/${encodeURIComponent(String(gameNumber))}/save-inspection`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = await response.json();
        if (
          controller.signal.aborted ||
          requestId !== inspectionRequestRef.current
        )
          return;
        if (!response.ok) {
          setError(payload.error ?? "Save inspection failed.");
          setInspectionState("error");
          return;
        }
        setInspection(payload);
        setInspectionState("loaded");
      } catch {
        if (
          controller.signal.aborted ||
          requestId !== inspectionRequestRef.current
        )
          return;
        setError("The save inspection request failed. Try again.");
        setInspectionState("error");
      } finally {
        if (inspectionControllerRef.current === controller) {
          inspectionControllerRef.current = null;
        }
      }
    });
  }, [gameNumber, onInspect, startTransition]);

  useEffect(() => {
    if (!hasSave) return;
    const timeoutId = window.setTimeout(() => inspect(false));
    return () => {
      window.clearTimeout(timeoutId);
      inspectionControllerRef.current?.abort();
      inspectionRequestRef.current += 1;
    };
  }, [hasSave, inspect]);

  return (
    <>
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Password reset:</CardTitle>
            <CardDescription>
              Reset/Change passwords in the latest save
            </CardDescription>
          </div>
          {hasSave && inspectionState !== "idle" ? (
            <button
              className="inline-flex min-h-11 shrink-0 self-start items-center justify-center border border-orange-400/50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-orange-300 transition-colors hover:bg-orange-400/10 hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              type="button"
              disabled={pending || selected !== null}
              onClick={() => inspect()}
            >
              {pending
                ? "Inspecting save..."
                : inspectionState === "error"
                  ? "Retry inspection"
                  : "Refresh"}
            </button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasSave ? <p>This campaign has no save to inspect.</p> : null}
        {hasSave && error ? (
          <p role="alert" className="border border-red-400/30 p-3 text-red-300">
            {error}
          </p>
        ) : null}
        {hasSave && inspection ? (
          <div aria-live="polite" className="space-y-3">
            {inspection.regimes.length === 0 ? (
              <p>No human-controlled regimes were found.</p>
            ) : (
              <ul className="divide-y divide-orange-400/20">
                {inspection.regimes.map((regime) => (
                  <li key={regime.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="min-w-0 max-w-full break-words">
                        {regime.name}
                      </span>
                      {regime.current ? (
                        <span className="border border-orange-400/50 px-2 py-1 text-xs">
                          Current regime
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-orange-300/70">
                      {regime.eligible
                        ? "Eligible for password reset"
                        : regime.reason}
                    </p>
                    {regime.eligible ? (
                      <button
                        className="max-w-full border border-orange-400 px-3 py-2 text-left"
                        type="button"
                        disabled={selected !== null}
                        onClick={() => setSelected(regime.id)}
                      >
                        Edit Password
                      </button>
                    ) : null}
                    {selected === regime.id ? (
                      <SavePasswordReset
                        gameNumber={gameNumber}
                        inspection={inspection}
                        regime={regime}
                        onCancel={() => setSelected(null)}
                        onSuccess={(name) => {
                          onSuccess(name, "reset");
                          setInspection(null);
                          setSelected(null);
                          setRecoveryVersion((value) => value + 1);
                        }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-orange-300/70">
              This inspection does not change the save or advance the turn.
            </p>
          </div>
        ) : null}
        {hasSave && selected === null ? (
          <SavePasswordUndo
            key={recoveryVersion}
            gameNumber={gameNumber}
            onSuccess={(name) => {
              setInspection(null);
              setSelected(null);
              onSuccess(name, "undo");
            }}
          />
        ) : null}
      </CardContent>
    </>
  );
}
