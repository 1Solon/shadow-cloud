import { useEffect, useState } from "react";
import type { Companion, Snapshot, Theme } from "../engine/port";
import { useCompanion } from "../engine/useCompanion";
import { Campaigns } from "./Campaigns";

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
                        "Not configured — available with device sign-in in the next milestone."}
                    </p>
                  </div>
                  <button className="outline-button" type="button" disabled>
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
              </div>
              <p className="foundation-note">
                Foundation build: preferences last for this session. Device
                sign-in, durable storage, and campaign transfers are not
                connected yet.
              </p>
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
