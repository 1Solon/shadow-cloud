import { useEffect, useRef, useState } from "react";
import type { Companion, Snapshot, Theme } from "../engine/port";
import { useCompanion } from "../engine/useCompanion";
import { Campaigns } from "./Campaigns";
import { ConnectGraphic } from "./ConnectGraphic";
import { ResetCompanion } from "./ResetCompanion";
import { ReviewGraphic } from "./ReviewGraphic";
import { ROOT_RELEASE_DURATION_MS, RootGraphic } from "./RootGraphic";
import { TurnModeGraphic } from "./TurnModeGraphic";
import {
  WelcomeNodeField,
  type WelcomeNodeFieldHandle,
} from "./WelcomeNodeField";

const setupSteps = [
  { stage: "welcome", label: "WELCOME", layout: "welcome" },
  { stage: "sign-in", label: "CONNECT", layout: "connect" },
  { stage: "companion-root", label: "ROOT", layout: "root" },
  { stage: "automatic-uploads", label: "TURN MODE", layout: "turn-mode" },
  { stage: "review", label: "REVIEW", layout: "review" },
] as const;

function ConnectedAccount({ displayName }: { displayName: string | null }) {
  return (
    <div className="identity" aria-live="polite">
      <span aria-hidden="true">USR</span>
      <div>
        <small>CONNECTED AS</small>
        <strong>{displayName ?? "NOT SIGNED IN"}</strong>
      </div>
    </div>
  );
}

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
  const [browserSignInAttempted, setBrowserSignInAttempted] = useState(false);
  const [showTokenFallback, setShowTokenFallback] = useState(false);
  const tokenInput = useRef<HTMLInputElement>(null);
  const [openingSetup, setOpeningSetup] = useState(false);
  const welcomeField = useRef<WelcomeNodeFieldHandle>(null);
  const openingSetupRef = useRef(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const stage = snapshot.onboarding.stage;
  const previousStage = useRef(stage);
  const connected = snapshot.session.state === "signed-in";
  const previousConnected = useRef(connected);
  const continueButton = useRef<HTMLButtonElement>(null);
  const [releasedRootPath, setReleasedRootPath] = useState(snapshot.rootPath);
  const rootReleasePending = Boolean(
    snapshot.rootPath && releasedRootPath !== snapshot.rootPath,
  );
  useEffect(() => {
    if (showTokenFallback) tokenInput.current?.focus();
  }, [showTokenFallback]);
  useEffect(() => {
    if (previousStage.current !== stage) {
      stepHeading.current?.focus({ preventScroll: true });
    }
    previousStage.current = stage;
  }, [stage]);
  useEffect(() => {
    if (pending) return;
    if (connected && !previousConnected.current) {
      setToken("");
      if (stage === "sign-in") continueButton.current?.focus();
    }
    previousConnected.current = connected;
  }, [connected, pending, stage]);
  useEffect(() => {
    const rootPath = snapshot.rootPath;
    if (!rootPath) {
      if (releasedRootPath !== null) setReleasedRootPath(null);
      return;
    }
    if (releasedRootPath === rootPath) return;
    const timeout = window.setTimeout(
      () => setReleasedRootPath(rootPath),
      ROOT_RELEASE_DURATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [releasedRootPath, snapshot.rootPath]);
  const beginSetup = async () => {
    if (pending || openingSetupRef.current) return;
    openingSetupRef.current = true;
    setOpeningSetup(true);
    try {
      const completed = await welcomeField.current?.beginSetup();
      if (completed !== false) await send({ type: "continue-onboarding" });
    } finally {
      welcomeField.current?.reset();
      openingSetupRef.current = false;
      setOpeningSetup(false);
    }
  };
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
          <div className="product-controls">
            <div className="connection">
              <small>NETWORK</small>
              <strong>
                {snapshot.connection.reachable ? "CONNECTED" : "DISCONNECTED"}
              </strong>
            </div>
            {connected && (
              <ConnectedAccount displayName={snapshot.displayName} />
            )}
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
        <main
          className="onboarding-page"
          data-welcome-transition={openingSetup || undefined}
        >
          <div
            className="onboarding-progress"
            aria-label={"Step " + step + " of 5"}
          >
            <span>SETUP</span>
            <strong>{String(step).padStart(2, "0")} / 05</strong>
            <ol className="onboarding-steps" aria-label="Setup steps">
              {setupSteps.map(({ label, stage: targetStage }, index) => {
                const number = index + 1;
                const available =
                  snapshot.onboarding.availableSteps.includes(targetStage);
                const state =
                  number === step
                    ? "current"
                    : available
                      ? "complete"
                      : "future";
                return (
                  <li
                    key={label}
                    data-state={state}
                    aria-current={number === step ? "step" : undefined}
                  >
                    <button
                      type="button"
                      aria-label={`${String(number).padStart(2, "0")} ${label}`}
                      disabled={
                        !available || number === step || pending || openingSetup
                      }
                      onClick={() =>
                        void send({
                          type: "navigate-onboarding",
                          stage: targetStage,
                        })
                      }
                    >
                      <b>{String(number).padStart(2, "0")}</b>
                      <em>{label}</em>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          <section
            key={stage}
            className={`onboarding-panel onboarding-panel--${setupSteps[step - 1].layout} onboarding-panel--reveal`}
          >
            {stage === "welcome" && (
              <>
                <WelcomeNodeField ref={welcomeField} />
                <div className="welcome-copy">
                  <small>WELCOME</small>
                  <h1 ref={stepHeading} tabIndex={-1}>
                    {"> WELCOME TO SHADOW CLOUD"}
                  </h1>
                  <p className="onboarding-lead">
                    Companion keeps a local directory on your computer synced
                    with Shadow Cloud, allowing you to easily share your saves
                    between players inside a Shadow Cloud game without going to
                    the WebUI or Discord
                  </p>
                </div>
                <div className="welcome-command">
                  <button
                    className="primary-button onboarding-action"
                    type="button"
                    disabled={pending || openingSetup}
                    aria-busy={openingSetup || pending}
                    onClick={() => void beginSetup()}
                  >
                    BEGIN SETUP
                  </button>
                  <span className="welcome-command-line" aria-hidden="true" />
                </div>
              </>
            )}
            {stage === "sign-in" && (
              <>
                <div className="connect-copy">
                  <small>SESSIONS</small>
                  <h1 ref={stepHeading} tabIndex={-1}>
                    {"> CONNECT THIS DEVICE"}
                  </h1>
                  <p className="onboarding-lead">
                    Sign in through the Shadow Cloud webui. This authenticates
                    the companion with your Shadow Cloud account, if sign in
                    with browser does not work, use the one-use token instead
                  </p>
                  {connected ? (
                    <div className="connect-authenticated">
                      <button
                        ref={continueButton}
                        className="primary-button onboarding-action"
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          void send({ type: "continue-onboarding" })
                        }
                      >
                        CONTINUE
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="onboarding-actions">
                        <button
                          className="primary-button"
                          type="button"
                          disabled={
                            pending ||
                            snapshot.session.state === "waiting-for-browser"
                          }
                          onClick={() => {
                            setBrowserSignInAttempted(true);
                            void send({ type: "start-browser-sign-in" });
                          }}
                        >
                          SIGN IN WITH BROWSER
                        </button>
                        {(browserSignInAttempted ||
                          snapshot.session.state === "waiting-for-browser") && (
                          <button
                            className="outline-button"
                            type="button"
                            aria-expanded={showTokenFallback}
                            aria-controls="token-fallback"
                            onClick={() => setShowTokenFallback(true)}
                          >
                            Didn't work?
                          </button>
                        )}
                      </div>
                      {snapshot.session.authorizationUrl && (
                        <div
                          className={`authorization-link${showTokenFallback ? "" : " authorization-link--overlay"}`}
                          role="status"
                        >
                          <strong>WAITING FOR APPROVAL</strong>
                          <p>
                            If the browser did not open, copy this link into any
                            browser where you can sign in:
                          </p>
                          <code>{snapshot.session.authorizationUrl}</code>
                        </div>
                      )}
                      <div id="token-fallback" hidden={!showTokenFallback}>
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
                            Paste the ten-minute token shown after approving the
                            link on another system.
                          </p>
                          <div>
                            <input
                              ref={tokenInput}
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
                      </div>
                    </>
                  )}
                </div>
                <ConnectGraphic stage={stage} connected={connected} />
              </>
            )}
            {stage === "companion-root" && (
              <>
                <div className="root-copy">
                  <small>LOCAL FILES</small>
                  <h1 ref={stepHeading} tabIndex={-1}>
                    {"> CHOOSE ROOT DIRECTORY"}
                  </h1>
                  <p className="onboarding-lead">
                    The root directory contains a folder for each one of your
                    Shadow Cloud games, your saves and the saves of other
                    players will be saved into these folders.
                  </p>
                  <div className="onboarding-actions">
                    <button
                      className="primary-button"
                      type="button"
                      disabled={pending || rootReleasePending}
                      onClick={() => {
                        if (snapshot.rootPath && rootReleasePending) return;
                        void send(
                          snapshot.rootPath
                            ? { type: "continue-onboarding" }
                            : { type: "choose-companion-root" },
                        );
                      }}
                    >
                      {snapshot.rootPath ? "CONTINUE" : "CHOOSE FOLDER"}
                    </button>
                  </div>
                </div>
                <RootGraphic
                  displayName={snapshot.displayName}
                  selected={Boolean(snapshot.rootPath)}
                />
              </>
            )}
            {stage === "automatic-uploads" && (
              <>
                <div className="turn-mode-copy">
                  <small>TURNS</small>
                  <h1 ref={stepHeading} tabIndex={-1}>
                    {"> TURN MODE"}
                  </h1>
                  <p className="onboarding-lead">
                    The Companion can either automatically send saves to Shadow
                    Cloud when you save to a Campaign directory, or it can queue
                    this until you manually approve.
                  </p>
                  <div className="turn-mode-preference">
                    <strong>AUTOMATIC UPLOADS</strong>
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
                </div>
                <TurnModeGraphic />
                <div className="welcome-command">
                  <button
                    className="primary-button onboarding-action"
                    type="button"
                    disabled={pending}
                    onClick={() => void send({ type: "continue-onboarding" })}
                  >
                    CONTINUE TO REVIEW
                  </button>
                  <span className="welcome-command-line" aria-hidden="true" />
                </div>
              </>
            )}
            {stage === "review" && (
              <>
                <div className="review-copy">
                  <small>FINAL REVIEW</small>
                  <h1 ref={stepHeading} tabIndex={-1}>
                    {"> REVIEW SETTINGS"}
                  </h1>
                  <p className="onboarding-lead">
                    Make sure to review your settings before you commit, you can
                    reset this process later in settings if you want to change
                    them.
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
                          ? "ENABLED"
                          : "DISABLED"}
                      </dd>
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
                </div>
                <ReviewGraphic />
              </>
            )}
          </section>
        </main>
        <footer className="product-footer">
          <span>VERSION: v{snapshot.appVersion}</span>
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
  useEffect(() => {
    if (snapshot?.onboarding.stage === "welcome") setSection("campaigns");
  }, [snapshot?.onboarding.stage]);

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
            <ConnectedAccount displayName={snapshot.displayName} />
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
              <div className="settings-list">
                <div className="settings-card">
                  <div>
                    <small>APPEARANCE</small>
                    <h2>INTERFACE THEME</h2>
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
                    <p>{snapshot.rootPath ?? "NOT CONFIGURED"}</p>
                    <p>
                      Select the existing root after moving it to reconnect your
                      Campaign folders.
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
                <div className="settings-card diagnostics-card">
                  <div>
                    <small>SUPPORT</small>
                    <h2>DIAGNOSTICS</h2>
                    <p>
                      Generate a redacted report to review and copy when needed.
                      It is not sent automatically.
                    </p>
                  </div>
                  <button
                    className="outline-button"
                    type="button"
                    disabled={pending}
                    onClick={() => void send({ type: "generate-diagnostics" })}
                  >
                    GENERATE DIAGNOSTICS
                  </button>
                  {snapshot.diagnostics && (
                    <pre
                      className="diagnostics-report"
                      role="region"
                      aria-label="Diagnostic report"
                      tabIndex={0}
                    >
                      {snapshot.diagnostics}
                    </pre>
                  )}
                </div>
                <ResetCompanion
                  pending={pending}
                  error={error}
                  dismissError={dismissError}
                  reset={() => send({ type: "reset-companion" })}
                />
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
