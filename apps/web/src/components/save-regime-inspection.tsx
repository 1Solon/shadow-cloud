"use client";

import {
  useSavePasswordWorkflow,
  type PasswordWorkflowIdentity,
} from "./save-password-workflow";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SavePasswordReset } from "./save-password-reset";
import { SavePasswordUndo } from "./save-password-undo";

export function SaveRegimeInspection(props: PasswordWorkflowIdentity) {
  const { canManagePasswords, hasSave } = props;
  const workflow = useSavePasswordWorkflow(props);
  const {
    success,
    inspection,
    inspectionError: error,
    selected,
    inspecting,
  } = workflow;
  const pending = workflow.pending !== null;
  if (!canManagePasswords) return null;
  return (
    <Card
      className="min-w-0 overflow-hidden font-mono text-sm text-orange-200"
      role="region"
      aria-label="In-game regime inspection"
    >
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Passwords:</CardTitle>
            <CardDescription>
              Reset/Change passwords in the latest save.
            </CardDescription>
          </div>
          {hasSave ? (
            <Button
              className="min-h-11 shrink-0 self-start px-3"
              type="button"
              variant="command"
              disabled={pending || inspecting || selected !== null}
              onClick={() => {
                void workflow.inspect();
                void workflow.readRecovery();
              }}
            >
              {inspecting
                ? "Inspecting save..."
                : error
                  ? "Retry inspection"
                  : "Refresh"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasSave ? <p>This campaign has no save to inspect.</p> : null}
        {workflow.message ? <p role="alert">{workflow.message}</p> : null}
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
                      <Button
                        className="max-w-full"
                        type="button"
                        variant="outline"
                        disabled={pending || selected !== null}
                        onClick={() => workflow.selectRegime(regime.id)}
                      >
                        Edit Password
                      </Button>
                    ) : null}
                    {selected === regime.id ? (
                      <SavePasswordReset
                        regime={regime}
                        pending={pending}
                        onCancel={workflow.cancelReset}
                        onReset={workflow.resetPassword}
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
        {hasSave && selected === null && workflow.recovery ? (
          <SavePasswordUndo
            undo={workflow.recovery}
            pending={pending}
            onUndo={workflow.undoPasswordReset}
            onCancel={workflow.cancelUndo}
          />
        ) : null}
        {workflow.recoveryError && selected === null ? (
          <div>
            <p role="alert">{workflow.recoveryError}</p>
            <Button
              type="button"
              variant="outline"
              disabled={pending || workflow.recovering}
              onClick={() => void workflow.readRecovery()}
            >
              Retry recovery
            </Button>
          </div>
        ) : null}
      </CardContent>
      {success ? (
        <CardContent>
          <p role="status">
            {success.action === "reset"
              ? `The in-game password for ${success.regimeName} was reset.`
              : `The previous password for ${success.regimeName} was restored.`}{" "}
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
