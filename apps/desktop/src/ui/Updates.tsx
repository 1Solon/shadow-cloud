import { AlertDialog } from "radix-ui";
import { useRef, useState } from "react";
import type { Command, Snapshot, UpdateBlocker } from "../engine/port";

const blockerDescriptions: Record<UpdateBlocker, string> = {
  countdown: "Cancel or finish automatic-send countdowns.",
  transfer: "Wait for active transfers to finish.",
  "uncertain-submission":
    "Resolve pending submission receipts before updating. Pausing does not settle an uncertain submission.",
  conflict:
    "Resolve Save conflicts before updating. Paused conflicts still need a resolution.",
};

function InstallBlockers({ blockers }: { blockers: UpdateBlocker[] }) {
  if (!blockers.length) return null;
  return (
    <div className="update-blockers" role="status">
      <strong>BEFORE INSTALLING</strong>
      <ul>
        {blockers.map((blocker) => (
          <li key={blocker}>{blockerDescriptions[blocker]}</li>
        ))}
      </ul>
    </div>
  );
}

export function Updates({
  snapshot,
  send,
  pending,
  error,
  dismissError,
}: {
  snapshot: Snapshot;
  send: (command: Command) => Promise<void>;
  pending: boolean;
  error: string | null;
  dismissError: () => void;
}) {
  const { updates } = snapshot;
  const [review, setReview] = useState<{
    offerId: string;
    version: string;
  } | null>(null);
  const requesting = useRef(false);
  const installing = updates.state === "installing";
  const busy = pending || installing || updates.state === "checking";
  const changedOffer = Boolean(
    review &&
    updates.state !== "installing" &&
    (review.offerId !== updates.offerId || review.version !== updates.version),
  );
  const canInstall =
    updates.state === "available" &&
    !changedOffer &&
    updates.installBlockers.length === 0;
  const status = {
    idle: "Updates have not been checked.",
    checking: "Checking for updates…",
    current: "You're up to date.",
    available: "An update is available.",
    installing: "Installing the update. The Companion will restart.",
    error: "The update could not finish. Review the details and try again.",
  }[updates.state];

  async function install() {
    if (!review || pending || requesting.current || !canInstall) return;
    requesting.current = true;
    try {
      await send({ type: "install-update", offerId: review.offerId });
    } finally {
      requesting.current = false;
    }
  }

  return (
    <section
      className="settings-card updates-card"
      aria-label="Companion updates"
    >
      <div>
        <small>APPLICATION</small>
        <h2>UPDATES</h2>
        <p>Installed version: {snapshot.appVersion}</p>
        {updates.version && <p>Available version: {updates.version}</p>}
        <p role="status">{status}</p>
        {updates.detail && <p>{updates.detail}</p>}
        <InstallBlockers blockers={updates.installBlockers} />
      </div>
      <label className="update-channel">
        UPDATE CHANNEL
        <select
          aria-label="Update channel"
          value={snapshot.preferences.updateChannel}
          disabled={busy}
          onChange={(event) => {
            const channel = event.target.value;
            if (channel === "stable" || channel === "preview")
              void send({ type: "set-update-channel", channel });
          }}
        >
          <option value="stable">Stable</option>
          <option value="preview">Preview</option>
        </select>
      </label>
      <p className="update-explanation">
        Stable follows regular releases. Preview includes prerelease versions;
        transfers still require the matching Shadow Cloud version.
      </p>
      <div className="update-actions">
        <button
          type="button"
          className="outline-button"
          disabled={busy}
          onClick={() => void send({ type: "check-for-updates" })}
        >
          CHECK FOR UPDATES
        </button>
        <AlertDialog.Root
          open={review !== null}
          onOpenChange={(open) => {
            if (pending || installing || requesting.current) return;
            if (!open) setReview(null);
            else if (updates.offerId && updates.version) {
              dismissError();
              setReview({ offerId: updates.offerId, version: updates.version });
            }
          }}
        >
          <AlertDialog.Trigger asChild>
            <button
              type="button"
              className="primary-button"
              disabled={
                pending || updates.state !== "available" || !updates.offerId
              }
            >
              REVIEW UPDATE
            </button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="reset-dialog-overlay" />
            <AlertDialog.Content
              className="reset-dialog"
              aria-busy={pending || installing}
            >
              <AlertDialog.Title>
                INSTALL COMPANION {review?.version}?
              </AlertDialog.Title>
              <AlertDialog.Description>
                The Companion will restart after installation. Ordinary Turn
                candidates remain saved for review.
              </AlertDialog.Description>
              <InstallBlockers blockers={updates.installBlockers} />
              {updates.state !== "available" && <p role="status">{status}</p>}
              {updates.detail && <p>{updates.detail}</p>}
              {changedOffer && (
                <p role="status">
                  The available update changed. Cancel and review it again
                  before installing.
                </p>
              )}
              {error && (
                <p className="reset-dialog-error" role="alert">
                  Update could not finish. {error}
                </p>
              )}
              <div className="reset-dialog-actions">
                <AlertDialog.Cancel asChild>
                  <button
                    type="button"
                    className="outline-button"
                    disabled={pending || installing}
                  >
                    CANCEL
                  </button>
                </AlertDialog.Cancel>
                <button
                  type="button"
                  className="primary-button"
                  disabled={pending || !canInstall}
                  onClick={() => void install()}
                >
                  {installing ? "INSTALLING…" : "INSTALL AND RESTART"}
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
      <p className="update-explanation">
        Updates verify their signatures. Publisher signing and macOS
        notarization are deferred.
      </p>
    </section>
  );
}
