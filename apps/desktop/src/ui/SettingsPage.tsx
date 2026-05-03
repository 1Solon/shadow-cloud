import { useEffect, useRef, useState } from "react";
import {
  defaultDesktopSettings,
  defaultRemoteSettings,
  type DesktopSettings,
  type RemoteSettings,
} from "@/storage/desktopState";

type SettingsPageProps = {
  desktopSettings: DesktopSettings;
  remotes: RemoteSettings;
  onClose: () => void;
  onSave: (
    remotes: RemoteSettings,
    desktopSettings: DesktopSettings,
  ) => Promise<void>;
  onResetAppState: () => Promise<void>;
};

const confirmationTextEnterDelayMs = 240;
const confirmationLines = [
  "> desktop-state --reset --all",
  "Desktop token and save root will be removed.",
  "Remote URLs, desktop preferences, and sync cache reset.",
  "Tracked campaign folders and their save files will be deleted.",
];

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeRemoteUrl(value: string) {
  return value.trim().replace(/\/+$/g, "");
}

function validateRemotes(remotes: RemoteSettings) {
  if (!isHttpUrl(remotes.apiBaseUrl)) {
    return "API remote must be an http or https URL.";
  }

  if (!isHttpUrl(remotes.webBaseUrl)) {
    return "Web remote must be an http or https URL.";
  }

  return null;
}

export function SettingsPage({
  desktopSettings,
  remotes,
  onClose,
  onSave,
  onResetAppState,
}: SettingsPageProps) {
  const [apiBaseUrl, setApiBaseUrl] = useState(remotes.apiBaseUrl);
  const [webBaseUrl, setWebBaseUrl] = useState(remotes.webBaseUrl);
  const [minimizeToTrayOnClose, setMinimizeToTrayOnClose] = useState(
    desktopSettings.minimizeToTrayOnClose,
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetConfirmationOpen, setIsResetConfirmationOpen] =
    useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [renderedConfirmationLines, setRenderedConfirmationLines] = useState<
    string[]
  >([]);
  const [activeConfirmationLineIndex, setActiveConfirmationLineIndex] =
    useState<number | null>(null);
  const confirmationTimeoutIdsRef = useRef<number[]>([]);

  function clearConfirmationTimeouts() {
    confirmationTimeoutIdsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    confirmationTimeoutIdsRef.current = [];
  }

  function scheduleConfirmationTimeout(callback: () => void, delay: number) {
    const timeoutId = window.setTimeout(callback, delay);
    confirmationTimeoutIdsRef.current.push(timeoutId);
  }

  function closeResetConfirmation() {
    clearConfirmationTimeouts();
    setRenderedConfirmationLines([]);
    setActiveConfirmationLineIndex(null);
    setIsResetConfirmationOpen(false);
  }

  useEffect(
    () => () => {
      clearConfirmationTimeouts();
    },
    [],
  );

  useEffect(() => {
    if (!isResetConfirmationOpen) {
      return;
    }

    let elapsed = confirmationTextEnterDelayMs;

    clearConfirmationTimeouts();
    scheduleConfirmationTimeout(() => {
      setRenderedConfirmationLines([]);
      setActiveConfirmationLineIndex(null);
    }, 0);

    confirmationLines.forEach((line, lineIndex) => {
      for (let charIndex = 1; charIndex <= line.length; charIndex += 1) {
        const snapshot = [
          ...confirmationLines.slice(0, lineIndex),
          line.slice(0, charIndex),
        ];

        scheduleConfirmationTimeout(() => {
          setRenderedConfirmationLines(snapshot);
          setActiveConfirmationLineIndex(lineIndex);
        }, elapsed);
        elapsed += lineIndex === 0 ? 16 : 9;
      }

      elapsed += 80;
    });

    scheduleConfirmationTimeout(() => {
      setRenderedConfirmationLines(confirmationLines);
      setActiveConfirmationLineIndex(null);
    }, elapsed);

    return () => {
      clearConfirmationTimeouts();
    };
  }, [isResetConfirmationOpen]);

  async function saveSettings(
    nextRemotes: RemoteSettings,
    nextDesktopSettings: DesktopSettings,
  ) {
    const validationError = validateRemotes(nextRemotes);

    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      await onSave(nextRemotes, nextDesktopSettings);
    } finally {
      setIsSaving(false);
    }
  }

  async function resetAppState() {
    setError(null);
    setIsResetting(true);

    try {
      await onResetAppState();
    } finally {
      setIsResetting(false);
    }
  }

  const isBusy = isSaving || isResetting;

  return (
    <div className="settings-overlay">
      <section aria-label="Settings" className="settings-panel">
        <header className="settings-header">
          <span>{"> SETTINGS"}</span>
          <button
            aria-label="Close settings"
            className="settings-close"
            disabled={isBusy}
            type="button"
            onClick={onClose}
          >
            X
          </button>
        </header>
        <form
          className="settings-body"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSettings(
              {
                apiBaseUrl: normalizeRemoteUrl(apiBaseUrl),
                webBaseUrl: normalizeRemoteUrl(webBaseUrl),
              },
              {
                minimizeToTrayOnClose,
              },
            );
          }}
        >
          <div className="settings-intro">
            <strong>Remotes</strong>
            <span>
              Point this desktop app at any compatible Shadow Cloud API and web
              instance.
            </span>
          </div>

          <label className="settings-field">
            <span>API URL</span>
            <input
              spellCheck={false}
              type="url"
              value={apiBaseUrl}
              onChange={(event) => {
                setApiBaseUrl(event.target.value);
              }}
            />
          </label>

          <label className="settings-field">
            <span>Web URL</span>
            <input
              spellCheck={false}
              type="url"
              value={webBaseUrl}
              onChange={(event) => {
                setWebBaseUrl(event.target.value);
              }}
            />
          </label>

          <div className="settings-section-heading">General</div>

          <label className="settings-checkbox">
            <input
              checked={minimizeToTrayOnClose}
              type="checkbox"
              onChange={(event) => {
                setMinimizeToTrayOnClose(event.target.checked);
              }}
            />
            <span>Minimize to tray when closing</span>
          </label>

          <div className="settings-section-heading">Danger Zone</div>

          <div className="settings-danger-zone">
            <div>
              <strong>Reset all app state</strong>
              <span>
                Clears sign-in, save root, sync cache, remote settings, desktop
                preferences, onboarding flags, and tracked campaign folders.
              </span>
            </div>
            <button
              className="settings-danger-button"
              disabled={isBusy}
              type="button"
              onClick={() => {
                setIsResetConfirmationOpen(true);
              }}
            >
              Reset all app state
            </button>
          </div>

          {error ? <div className="settings-error">{error}</div> : null}

          <div className="settings-actions">
            <button
              disabled={isBusy}
              type="button"
              onClick={() => {
                setApiBaseUrl(defaultRemoteSettings.apiBaseUrl);
                setWebBaseUrl(defaultRemoteSettings.webBaseUrl);
                setMinimizeToTrayOnClose(
                  defaultDesktopSettings.minimizeToTrayOnClose,
                );
                setError(null);
                void saveSettings(
                  defaultRemoteSettings,
                  defaultDesktopSettings,
                );
              }}
            >
              Reset defaults
            </button>
            <button disabled={isBusy} type="button" onClick={onClose}>
              Cancel
            </button>
            <button disabled={isBusy} type="submit">
              Save settings
            </button>
          </div>
        </form>
      </section>
      {isResetConfirmationOpen ? (
        <div
          className="settings-confirmation-overlay"
          onClick={closeResetConfirmation}
        >
          <section
            aria-label="Confirm app state reset"
            className="settings-confirmation-panel"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="settings-header">
              <span>Confirm App State Reset</span>
              <button
                aria-label="Close confirmation"
                className="settings-close"
                disabled={isResetting}
                type="button"
                onClick={closeResetConfirmation}
              >
                X
              </button>
            </header>
            <div className="settings-confirmation-body">
              <div className="settings-confirmation-terminal">
                {renderedConfirmationLines.map((line, index) => (
                  <div key={`reset-confirmation-${index}`}>
                    {line}
                    {activeConfirmationLineIndex === index ? (
                      <span
                        aria-hidden="true"
                        className="settings-confirmation-caret"
                      />
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="settings-actions">
                <button
                  disabled={isResetting}
                  type="button"
                  onClick={closeResetConfirmation}
                >
                  Cancel
                </button>
                <button
                  className="settings-danger-button"
                  disabled={isResetting}
                  type="button"
                  onClick={() => {
                    void resetAppState();
                  }}
                >
                  {isResetting ? "Resetting..." : "Reset"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
