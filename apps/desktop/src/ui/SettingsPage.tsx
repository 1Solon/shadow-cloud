import { useState } from "react";
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
};

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
}: SettingsPageProps) {
  const [apiBaseUrl, setApiBaseUrl] = useState(remotes.apiBaseUrl);
  const [webBaseUrl, setWebBaseUrl] = useState(remotes.webBaseUrl);
  const [minimizeToTrayOnClose, setMinimizeToTrayOnClose] = useState(
    desktopSettings.minimizeToTrayOnClose,
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  return (
    <div className="settings-overlay">
      <section aria-label="Settings" className="settings-panel">
        <header className="settings-header">
          <span>{"> SETTINGS"}</span>
          <button
            aria-label="Close settings"
            className="settings-close"
            disabled={isSaving}
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

          {error ? <div className="settings-error">{error}</div> : null}

          <div className="settings-actions">
            <button
              disabled={isSaving}
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
            <button disabled={isSaving} type="button" onClick={onClose}>
              Cancel
            </button>
            <button disabled={isSaving} type="submit">
              Save settings
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
