import { useEffect, useState } from "react";
import type { Companion, Snapshot, Theme } from "../engine/port";
import { useCompanion } from "../engine/useCompanion";
import { Campaigns } from "./Campaigns";

function CredentialStorageNotice({ snapshot }: { snapshot: Snapshot }) {
  if (
    snapshot.session.state !== "signed-in" ||
    snapshot.session.credentialStorage !== "memory-only"
  )
    return null;
  return (
    <div className="connection-notice connection-notice--warning" role="status">
      <strong>MEMORY-ONLY SESSION</strong>
      <p>
        The operating-system credential vault is unavailable. This Device
        session lasts only until you quit; sign in again after quitting.
      </p>
    </div>
  );
}

function Onboarding({
  snapshot,
  pending,
  error,
  send,
  dismissError,
}: {
  snapshot: Snapshot;
  pending: boolean;
  error: string | null;
  send: (command: Parameters<Companion["command"]>[0]) => Promise<void>;
  dismissError: () => void;
}) {
  const [token, setToken] = useState("");
  const stage = snapshot.onboarding.stage;
  const step =
    stage === "welcome"
      ? 1
      : stage === "sign-in"
        ? 2
        : stage === "companion-root"
          ? 3
          : stage === "automatic-uploads"
            ? 4
            : 5;

  return (
    <div className="desktop-stage">
      <div className="terminal-frame terminal-frame--onboarding">
        <header className="product-header">
          <div className="product-title">
            <span>
              {"> SHADOW CLOUD"}
              <em> / COMPANION</em>
            </span>
            <i aria-hidden="true" />
          </div>
          <div className="connection">
            <small>NETWORK</small>
            <strong>
              {snapshot.connection.reachable ? "CONNECTED" : "DISCONNECTED"}
            </strong>
          </div>
        </header>
        {error && (
          <div className="command-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="outline-button"
              onClick={dismissError}
            >
              DISMISS
            </button>
          </div>
        )}
        <CredentialStorageNotice snapshot={snapshot} />
        <main className="onboarding-page">
          <div
            className="onboarding-progress"
            aria-label={"Step " + step + " of 5"}
          >
            <span>SETUP</span>
            <strong>{String(step).padStart(2, "0")} / 05</strong>
          </div>
          {stage === "welcome" && (
            <section className="onboarding-panel">
              <small>WELCOME</small>
              <h1>{"> WELCOME TO SHADOW CLOUD"}</h1>
              <p className="onboarding-lead">
                The Companion keeps each Campaign&apos;s saves in its own folder
                and moves every new turn safely between this computer and Shadow
                Cloud.
              </p>
              <div className="promise-grid">
                <div>
                  <strong>ONE CAMPAIGN, ONE FOLDER</strong>
                  <p>Received saves and your local work stay together.</p>
                </div>
                <div>
                  <strong>NO SILENT OVERWRITES</strong>
                  <p>Your existing files are never replaced or deleted.</p>
                </div>
                <div>
                  <strong>SAFE WHEN OFFLINE</strong>
                  <p>Local work waits until the connection is ready.</p>
                </div>
              </div>
              <button
                className="primary-button onboarding-action"
                type="button"
                disabled={pending}
                onClick={() => void send({ type: "continue-onboarding" })}
              >
                BEGIN SETUP
              </button>
            </section>
          )}
          {stage === "sign-in" && (
            <section className="onboarding-panel">
              <small>DEVICE SESSION</small>
              <h1>{"> CONNECT THIS DEVICE"}</h1>
              <p className="onboarding-lead">
                Sign in through the Shadow Cloud website. This Device session
                can observe your Campaigns and transfer seated turns; it cannot
                administer Campaigns or your account.
              </p>
              <button
                className="primary-button onboarding-action"
                type="button"
                disabled={
                  pending || snapshot.session.state === "waiting-for-browser"
                }
                onClick={() => void send({ type: "start-browser-sign-in" })}
              >
                SIGN IN WITH BROWSER
              </button>
              {snapshot.session.authorizationUrl && (
                <div className="authorization-link" role="status">
                  <strong>WAITING FOR APPROVAL</strong>
                  <p>
                    If the browser did not open, copy this link into any browser
                    where you can sign in:
                  </p>
                  <code>{snapshot.session.authorizationUrl}</code>
                </div>
              )}
              <div className="onboarding-divider">
                <span>OR USE A ONE-USE TOKEN</span>
              </div>
              <form
                className="token-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send({ type: "submit-handoff-token", token });
                }}
              >
                <label htmlFor="handoff-token">One-use token</label>
                <p>
                  Paste the ten-minute token shown after approving the link on
                  another system.
                </p>
                <div>
                  <input
                    id="handoff-token"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                  <button
                    className="outline-button"
                    type="submit"
                    disabled={pending || !token.trim()}
                  >
                    CONNECT WITH TOKEN
                  </button>
                </div>
              </form>
            </section>
          )}
          {stage === "companion-root" && (
            <section className="onboarding-panel">
              <small>LOCAL FILES</small>
              <h1>{"> CHOOSE COMPANION ROOT"}</h1>
              <p className="onboarding-lead">
                Choose one directory. Each Campaign receives a uniquely named,
                marker-owned folder directly inside it.
              </p>
              <div className="onboarding-callout">
                Existing unrelated folders are never adopted, merged, or
                renamed. A name conflict stops setup with an explicit error.
              </div>
              <button
                className="primary-button onboarding-action"
                type="button"
                disabled={pending}
                onClick={() => void send({ type: "choose-companion-root" })}
              >
                CHOOSE FOLDER
              </button>
            </section>
          )}
          {stage === "automatic-uploads" && (
            <section className="onboarding-panel">
              <small>TURN CANDIDATES</small>
              <h1>{"> TURN SUBMISSION"}</h1>
              <p className="onboarding-lead">
                When one stable new .se1 file appears during your turn, the
                Companion can send it automatically after a visible 15-second
                cancellation window.
              </p>
              <div className="choice-card">
                <div>
                  <strong>AUTOMATIC UPLOADS</strong>
                  <p>
                    Enabled by default. You can change this globally or per
                    Campaign later.
                  </p>
                </div>
                <button
                  className="outline-button"
                  type="button"
                  role="switch"
                  aria-label="Automatic uploads"
                  aria-checked={snapshot.preferences.automaticUploads}
                  disabled={pending}
                  onClick={() =>
                    void send({
                      type: "set-automatic-uploads",
                      enabled: !snapshot.preferences.automaticUploads,
                    })
                  }
                >
                  {snapshot.preferences.automaticUploads
                    ? "ENABLED"
                    : "DISABLED"}
                </button>
              </div>
              <button
                className="primary-button onboarding-action"
                type="button"
                disabled={pending}
                onClick={() => void send({ type: "continue-onboarding" })}
              >
                CONTINUE TO REVIEW
              </button>
            </section>
          )}
          {stage === "review" && (
            <section className="onboarding-panel">
              <small>FINAL REVIEW</small>
              <h1>{"> REVIEW AND ENABLE SYNC"}</h1>
              <p className="onboarding-lead">
                Nothing can be sent until you finish this review.
              </p>
              <dl className="review-list">
                <div>
                  <dt>CONNECTED AS</dt>
                  <dd>{snapshot.displayName}</dd>
                </div>
                <div>
                  <dt>COMPANION ROOT</dt>
                  <dd>{snapshot.rootPath}</dd>
                </div>
                <div>
                  <dt>AUTOMATIC UPLOADS</dt>
                  <dd>
                    {snapshot.preferences.automaticUploads
                      ? "ENABLED — 15 SECOND CANCELLATION"
                      : "DISABLED — MANUAL SEND"}
                  </dd>
                </div>
                <div>
                  <dt>CAMPAIGN FOLDERS</dt>
                  <dd>UNIQUE MARKER OWNERSHIP REQUIRED</dd>
                </div>
              </dl>
              <button
                className="primary-button onboarding-action"
                type="button"
                disabled={pending}
                onClick={() => void send({ type: "complete-onboarding" })}
              >
                FINISH SETUP
              </button>
            </section>
          )}
        </main>
        <footer className="product-footer">
          <span>VERSION: v{snapshot.appVersion}</span>
          <span>TRANSFERS: LOCKED UNTIL FINAL REVIEW</span>
        </footer>
      </div>
    </div>
  );
}

function ConnectionNotice({ snapshot }: { snapshot: Snapshot }) {
  const state = snapshot.connection.state;
  if (state === "connected" && !snapshot.paused) return null;
  const heading =
    state === "update-required"
      ? "UPDATE REQUIRED"
      : state === "offline"
        ? "YOU ARE OFFLINE"
        : state === "checking"
          ? "CHECKING CONNECTION"
          : "SYNC PAUSED";
  const description =
    state === "update-required"
      ? `Companion protocol ${snapshot.protocolVersion} does not match server ${snapshot.connection.serverProtocolVersion}. Local work is preserved; transfers remain disabled until the versions match.`
      : state === "offline"
        ? "Campaigns remain visible. Transfers are stopped; the Companion checks the connection every 30 seconds."
        : state === "checking"
          ? "Checking the server protocol before enabling campaign transfers."
          : "Campaigns remain visible, but downloads and sends are stopped.";
  return (
    <div
      className={`connection-notice ${state === "update-required" || state === "offline" ? "connection-notice--warning" : ""}`}
      role="status"
    >
      <strong>{heading}</strong>
      <p>{description}</p>
    </div>
  );
}

export function App({
  companion,
  development = false,
}: {
  companion: Companion;
  development?: boolean;
}) {
  const { snapshot, error, pending, send, dismissError } =
    useCompanion(companion);
  const [section, setSection] = useState("campaigns");
  useEffect(() => {
    document.documentElement.dataset.theme =
      snapshot?.preferences.theme ?? "system";
  }, [snapshot?.preferences.theme]);

  if (!snapshot)
    return (
      <main className="startup">
        <h1>{"> SHADOW-CLOUD / COMPANION"}</h1>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p role="status">Starting the Companion engine…</p>
        )}
      </main>
    );
  const mismatch = snapshot.connection.state === "update-required";

  if (snapshot.onboarding.stage !== "complete") {
    return (
      <Onboarding
        snapshot={snapshot}
        pending={pending}
        error={error}
        send={send}
        dismissError={dismissError}
      />
    );
  }

  return (
    <div className="desktop-stage">
      <div className="terminal-frame">
        <header className="product-header">
          <div className="product-title">
            <span>
              {"> SHADOW-CLOUD"}
              <em> / COMPANION</em>
            </span>
            <i aria-hidden="true" />
          </div>
          <div className="product-controls">
            <div className="connection">
              <small>NETWORK</small>
              <strong>
                {snapshot.connection.reachable ? "CONNECTED" : "DISCONNECTED"}
              </strong>
            </div>
            <div className="identity">
              <span aria-hidden="true">USR</span>
              <div>
                <small>CONNECTED AS</small>
                <strong>{snapshot.displayName ?? "NOT SIGNED IN"}</strong>
              </div>
            </div>
            <button
              className="outline-button"
              type="button"
              disabled={pending || (mismatch && snapshot.paused)}
              onClick={() =>
                void send({ type: "set-paused", paused: !snapshot.paused })
              }
            >
              {snapshot.paused ? "RESUME SYNC" : "PAUSE SYNC"}
            </button>
          </div>
        </header>
        <nav className="product-nav" aria-label="Primary navigation">
          {["campaigns", "activity", "settings"].map((page) => (
            <button
              key={page}
              type="button"
              aria-current={section === page ? "page" : undefined}
              onClick={() => setSection(page)}
            >
              {page.toUpperCase()}
            </button>
          ))}
        </nav>
        <CredentialStorageNotice snapshot={snapshot} />
        <ConnectionNotice snapshot={snapshot} />
        {error && (
          <div className="command-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="outline-button"
              onClick={dismissError}
            >
              DISMISS
            </button>
          </div>
        )}
        <main className="terminal-content">
          <div hidden={section !== "campaigns"}>
            <Campaigns snapshot={snapshot} send={send} pending={pending} />
          </div>
          {section === "activity" && (
            <section className="utility-page">
              <h1>{"> RECENT ACTIVITY"}</h1>
              <p className="section-intro">
                Recent turns across your monitored campaigns.
              </p>
              <div className="activity-list">
                {snapshot.activity.length ? (
                  snapshot.activity.map((activity) => (
                    <article key={activity.id}>
                      <span aria-hidden="true">{">"}</span>
                      <div>
                        <strong>{activity.campaignName}</strong>
                        <p>{activity.description}</p>
                      </div>
                      <time dateTime={activity.occurredAt}>
                        {new Date(activity.occurredAt).toLocaleString()}
                      </time>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <p>No turns recorded yet.</p>
                  </div>
                )}
              </div>
            </section>
          )}
          {section === "settings" && (
            <section className="utility-page">
              <h1>{"> SETTINGS"}</h1>
              <p className="section-intro">Preferences</p>
              <div className="settings-list">
                <div className="settings-card">
                  <div>
                    <small>APPEARANCE</small>
                    <h2>INTERFACE THEME</h2>
                    <p>Choose a dark, light, or system-matched theme.</p>
                  </div>
                  <div
                    className="theme-options"
                    role="group"
                    aria-label="Interface theme"
                  >
                    {(["dark", "light", "system"] satisfies Theme[]).map(
                      (theme) => (
                        <button
                          type="button"
                          key={theme}
                          aria-pressed={snapshot.preferences.theme === theme}
                          disabled={pending}
                          onClick={() =>
                            void send({ type: "set-theme", theme })
                          }
                        >
                          {theme.toUpperCase()}
                        </button>
                      ),
                    )}
                  </div>
                </div>
                <div className="settings-card">
                  <div>
                    <small>FILES</small>
                    <h2>COMPANION ROOT</h2>
                    <p>
                      {snapshot.rootPath ??
                        "Not configured — choose a Companion root before transfers can start."}
                    </p>
                  </div>
                  <button
                    className="outline-button"
                    type="button"
                    disabled={pending}
                    onClick={() => void send({ type: "choose-companion-root" })}
                  >
                    CHANGE FOLDER
                  </button>
                </div>
                <div className="settings-card">
                  <div>
                    <small>TRANSFERS</small>
                    <h2>AUTOMATIC UPLOADS</h2>
                    <p>
                      Send new turn candidates after the 15-second cancellation
                      window. When disabled, send turns manually.
                    </p>
                  </div>
                  <button
                    className="outline-button"
                    type="button"
                    role="switch"
                    aria-label="Automatic uploads"
                    aria-checked={snapshot.preferences.automaticUploads}
                    disabled={
                      pending ||
                      (mismatch && !snapshot.preferences.automaticUploads)
                    }
                    onClick={() =>
                      void send({
                        type: "set-automatic-uploads",
                        enabled: !snapshot.preferences.automaticUploads,
                      })
                    }
                  >
                    {snapshot.preferences.automaticUploads
                      ? "ENABLED"
                      : "DISABLED"}
                  </button>
                </div>
                <div className="settings-card">
                  <div>
                    <small>DEVICE SESSION</small>
                    <h2>CONNECTED AS {snapshot.displayName}</h2>
                    <p>
                      Refresh secret:{" "}
                      {snapshot.session.credentialStorage === "vault"
                        ? "protected by the operating-system vault"
                        : "memory only — sign in again after quitting"}
                    </p>
                  </div>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={pending}
                    onClick={() => void send({ type: "sign-out" })}
                  >
                    SIGN OUT
                  </button>
                </div>
              </div>
            </section>
          )}
        </main>
        <footer className="product-footer">
          <span>
            VERSION: v{snapshot.appVersion} · ROOT:{" "}
            {snapshot.rootPath ?? "NOT CONFIGURED"}
          </span>
          <span>
            {development ? "DEVELOPMENT DATA · " : ""}CAMPAIGNS:{" "}
            {snapshot.campaigns.length} MONITORED
          </span>
        </footer>
      </div>
    </div>
  );
}
