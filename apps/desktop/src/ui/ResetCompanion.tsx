import { AlertDialog } from "radix-ui";
import { useRef, useState } from "react";

export function ResetCompanion({
  pending,
  error,
  dismissError,
  reset,
}: {
  pending: boolean;
  error: string | null;
  dismissError: () => void;
  reset: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const resetting = useRef(false);

  async function confirmReset() {
    if (pending || resetting.current) return;
    resetting.current = true;
    try {
      // Success replaces Settings with Welcome. Keep this dialog open on an
      // engine error so the user can read it, retry, or cancel.
      await reset();
    } finally {
      resetting.current = false;
    }
  }

  return (
    <div className="settings-card">
      <div>
        <small>START OVER</small>
        <h2>RESET COMPANION</h2>
      </div>
      <AlertDialog.Root
        open={open}
        onOpenChange={(next) => {
          if (pending || resetting.current) return;
          if (next) dismissError();
          setOpen(next);
        }}
      >
        <AlertDialog.Trigger asChild>
          <button type="button" className="danger-button" disabled={pending}>
            RESET COMPANION
          </button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="reset-dialog-overlay" />
          <AlertDialog.Content className="reset-dialog" aria-busy={pending}>
            <AlertDialog.Title>RESET COMPANION?</AlertDialog.Title>
            <AlertDialog.Description>
              This signs you out, forgets your selected Companion root, and
              restores the default theme and upload preferences. Sync stays off
              until you finish setup again.
            </AlertDialog.Description>
            <p>
              Your local saves and cloud campaigns will not be deleted. Local
              sync-tracking records are kept so received turns stay recognized.
            </p>
            {error && (
              <p className="reset-dialog-error" role="alert">
                Reset was not completed. {error}
              </p>
            )}
            <div className="reset-dialog-actions">
              <AlertDialog.Cancel asChild>
                <button
                  type="button"
                  className="outline-button"
                  disabled={pending}
                >
                  CANCEL
                </button>
              </AlertDialog.Cancel>
              <button
                type="button"
                className="danger-button"
                disabled={pending}
                onClick={() => void confirmReset()}
              >
                {pending ? "RESETTING…" : "RESET AND RESTART SETUP"}
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
