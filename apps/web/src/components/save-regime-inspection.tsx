"use client";

import { useState, useTransition } from "react";
import type { SaveInspection } from "@/lib/save-inspection";
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
  if (!isOverlord) return null;
  return (
    <section
      className="space-y-4 border border-orange-400/30 bg-black/40 p-4 font-mono text-sm text-orange-200 sm:p-6"
      aria-label="In-game regime inspection"
    >
      <InspectionDraft
        key={saveRevision}
        gameNumber={gameNumber}
        hasSave={hasSave}
        onInspect={() => setSuccess(null)}
        onSuccess={(name, action) => setSuccess({ name, action })}
      />
      {success ? (
        <p role="status">
          {success.action === "reset"
            ? `The in-game password for ${success.name} was reset.`
            : `The previous password for ${success.name} was restored.`}{" "}
          The latest save has been replaced; the turn has not advanced. Download
          the updated save before continuing. If you already started from the
          previous copy, restart from the updated save.
          {success.action === "reset"
            ? " Share the replacement password privately."
            : null}
        </p>
      ) : null}
    </section>
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
  const [pending, startTransition] = useTransition();

  function inspect() {
    setInspection(null);
    setError(null);
    setSelected(null);
    onInspect();
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/games/${encodeURIComponent(String(gameNumber))}/save-inspection`,
          { cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error ?? "Save inspection failed.");
          return;
        }
        setInspection(payload);
      } catch {
        setError("The save inspection request failed. Try again.");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-base uppercase tracking-[0.14em]">
          In-game regimes
        </h2>
        {hasSave ? (
          <button
            className="border border-orange-400 px-3 py-2 text-xs uppercase tracking-wider hover:bg-orange-400/10 disabled:opacity-50"
            type="button"
            disabled={pending || selected !== null}
            onClick={inspect}
          >
            {pending ? "Inspecting save..." : "Inspect regimes"}
          </button>
        ) : null}
      </div>
      <p className="text-orange-300/70">
        Inspect and reset passwords in the latest save. Regimes are in-game
        nations, not Cloud seats or accounts. Existing passwords are never
        shown.
      </p>
      {!hasSave ? <p>This campaign has no save to inspect.</p> : null}
      {error ? (
        <p role="alert" className="border border-red-400/30 p-3 text-red-300">
          {error}
        </p>
      ) : null}
      {inspection ? (
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
                      className="max-w-full break-all border border-orange-400 px-3 py-2 text-left"
                      type="button"
                      disabled={selected !== null}
                      onClick={() => setSelected(regime.id)}
                    >
                      Choose {regime.name}
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
    </>
  );
}
