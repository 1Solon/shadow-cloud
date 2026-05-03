import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  decodeDesktopTokenAvatarUrl,
  decodeDesktopTokenDisplayName,
} from '@/auth/desktopToken';
import { listenForDesktopAuth, startDesktopSignIn } from '@/auth/deepLinkAuth';
import { webBaseUrl } from '@/api/shadowCloudApi';
import { getErrorMessage } from '@/errors/error-message';
import { buildWebGameUrl } from '@/navigation/webGameLinks';
import { loadSyncState, saveSyncState } from '@/storage/desktopState';
import { runSyncOnce, type SyncState } from '@/sync/sync-engine';
import { createNonOverlappingRunner } from '@/sync/sync-runner';
import { createTauriSyncAdapters, decodeTokenSubject } from '@/tauri/fileAdapters';
import { sortCampaignEntries } from './campaignOrdering';

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function formatTimestamp(timestamp?: string) {
  if (!timestamp) {
    return 'never';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(timestamp));
}

function getNextSyncTime(state: SyncState | null, lastSyncAt: Date | null) {
  if (!state || state.paused || !lastSyncAt) {
    return 'paused';
  }

  return formatTime(
    new Date(lastSyncAt.getTime() + state.syncIntervalSeconds * 1_000),
  );
}

export function App() {
  const adapters = useMemo(() => createTauriSyncAdapters(), []);
  const [state, setState] = useState<SyncState | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const stateRef = useRef<SyncState | null>(null);
  const runnerRef = useRef(
    createNonOverlappingRunner(async () => {
      if (!stateRef.current) {
        return;
      }

      const nextState = await runSyncOnce(stateRef.current, adapters);
      stateRef.current = nextState;
      setState(nextState);
      setLastSyncAt(new Date());
      await saveSyncState(nextState);
    }),
  );

  useEffect(() => {
    let mounted = true;

    void loadSyncState().then((loadedState) => {
      if (!mounted) {
        return;
      }

      stateRef.current = loadedState;
      setState(loadedState);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClock(new Date());
    }, 1_000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listenForDesktopAuth(async (token) => {
        const nextState = {
          ...(stateRef.current ?? {
            saveRoot: null,
            token: null,
            syncIntervalSeconds: 120,
            paused: false,
            campaigns: {},
          }),
          token,
          lastStatus: 'Signed in through Discord',
          lastError: undefined,
        };
        stateRef.current = nextState;
        setState(nextState);
        await saveSyncState(nextState);
      }).then((nextUnlisten) => {
        unlisten = nextUnlisten;
      }).catch((error) => {
        void updateState((current) => ({
          ...current,
          lastStatus: 'Desktop auth listener failed',
          lastError: getErrorMessage(error, 'Desktop auth listener failed.'),
        }));
      });

    return () => {
      unlisten?.();
    };
  }, []);

  const syncNow = useCallback(async () => {
    await runnerRef.current.tick();
  }, []);

  useEffect(() => {
    if (!state || state.paused) {
      return;
    }

    const interval = window.setInterval(() => {
      void syncNow();
    }, state.syncIntervalSeconds * 1_000);

    return () => window.clearInterval(interval);
  }, [state?.paused, state?.syncIntervalSeconds, state, syncNow]);

  async function updateState(updater: (current: SyncState) => SyncState) {
    if (!stateRef.current) {
      return;
    }

    const nextState = updater(stateRef.current);
    stateRef.current = nextState;
    setState(nextState);
    await saveSyncState(nextState);
  }

  async function selectSaveRoot() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Shadow Empire save root',
    });

    if (typeof selected !== 'string') {
      return;
    }

    await updateState((current) => ({
      ...current,
      saveRoot: selected,
      lastStatus: 'Save root selected',
      lastError: undefined,
    }));
  }

  async function signOut() {
    await updateState((current) => ({
      ...current,
      token: null,
      lastStatus: 'Signed out',
      lastError: undefined,
    }));
  }

  async function signIn() {
    try {
      await startDesktopSignIn();
    } catch (error) {
      await updateState((current) => ({
        ...current,
        lastStatus: 'Desktop protocol registration failed',
        lastError: getErrorMessage(error, 'Desktop sign-in failed.'),
      }));
    }
  }

  async function togglePaused() {
    await updateState((current) => ({
      ...current,
      paused: !current.paused,
      lastStatus: !current.paused ? 'Sync paused' : 'Sync resumed',
      lastError: undefined,
    }));
  }

  async function setIntervalSeconds(value: number) {
    await updateState((current) => ({
      ...current,
      syncIntervalSeconds: value,
    }));
  }

  async function openCampaignInWeb(gameNumber?: number) {
    if (!gameNumber) {
      return;
    }

    try {
      await openUrl(buildWebGameUrl(webBaseUrl, gameNumber));
    } catch (error) {
      await updateState((current) => ({
        ...current,
        lastStatus: 'Web handoff failed',
        lastError: getErrorMessage(error, 'Could not open campaign in web UI.'),
      }));
    }
  }

  const currentUserId = state?.token ? decodeTokenSubject(state.token) : null;
  const currentUserName = state?.token
    ? decodeDesktopTokenDisplayName(state.token)
    : null;
  const currentUserAvatarUrl = state?.token
    ? decodeDesktopTokenAvatarUrl(state.token)
    : null;
  const campaigns = sortCampaignEntries(state?.campaigns ?? {}, currentUserId);

  if (!state) {
    return (
      <main className="terminal-screen">
        <section className="terminal-frame">BOOTING SHADOW-CLOUD SYNC...</section>
      </main>
    );
  }

  return (
    <main className="terminal-screen">
      <section className="terminal-frame">
        <header className="terminal-header">
          <div className="terminal-title">
            <span>{'> SHADOW CLOUD: LOCAL'}</span>
            <span aria-hidden="true" className="terminal-cursor" />
          </div>
          <div className="terminal-header-actions">
            <div className="user-badge">
              <div className="user-badge-avatar">
                {currentUserAvatarUrl ? (
                  <>
                    <img
                      alt={currentUserName ?? 'Connected user'}
                      src={currentUserAvatarUrl}
                    />
                    <span aria-hidden="true" className="user-badge-avatar-tint" />
                  </>
                ) : (
                  <span>USR</span>
                )}
              </div>
              <div className="user-badge-copy">
                <span className="user-badge-label">
                  {state.token ? 'Connected as' : 'Identity'}
                </span>
                <span className="user-badge-name">
                  {state.token ? (currentUserName ?? 'SIGNED IN') : '[GUEST]'}
                </span>
              </div>
            </div>
            {state.token ? (
              <button type="button" onClick={signOut}>
                Sign out
              </button>
            ) : (
              <button type="button" onClick={signIn}>
                Sign in
              </button>
            )}
            <span>{formatTime(clock)}</span>
          </div>
        </header>

        <section className="control-grid">
          <button type="button" onClick={selectSaveRoot}>
            Select save root
          </button>
          <button type="button" onClick={syncNow}>
            Sync now
          </button>
          <button type="button" onClick={togglePaused}>
            {state.paused ? 'Resume timer' : 'Pause timer'}
          </button>
          <label className="interval-control">
            <span>Interval</span>
            <select
              value={state.syncIntervalSeconds}
              onChange={(event) => {
                void setIntervalSeconds(Number(event.target.value));
              }}
            >
              <option value={60}>60s</option>
              <option value={120}>120s</option>
              <option value={300}>5m</option>
              <option value={900}>15m</option>
            </select>
          </label>
        </section>

        <section className="status-strip">
          <div>ROOT: {state.saveRoot ?? 'not selected'}</div>
          <div>NEXT SYNC: {getNextSyncTime(state, lastSyncAt)}</div>
          <div>{state.lastError ? `ERROR: ${state.lastError}` : `STATUS: ${state.lastStatus ?? 'idle'}`}</div>
        </section>

        <section className="campaign-section">
          <h1>{'> Your Campaigns'}</h1>
          {campaigns.length === 0 ? (
            <div className="empty-panel">
              Sign in, choose a save root, then run sync to populate campaigns.
            </div>
          ) : (
            <div className="campaign-list">
              {campaigns.map(([campaignId, campaign]) => {
                const isUsersTurn = Boolean(
                  currentUserId &&
                    campaign.activePlayerUserId === currentUserId,
                );

                return (
                  <article
                    className={`campaign-row${isUsersTurn ? ' is-users-turn' : ''}`}
                    key={campaignId}
                    role="link"
                    tabIndex={0}
                    onClick={() => {
                      void openCampaignInWeb(campaign.gameNumber);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') {
                        return;
                      }

                      event.preventDefault();
                      void openCampaignInWeb(campaign.gameNumber);
                    }}
                  >
                    <div className="campaign-main">
                      <div className="campaign-title">
                        {`${campaign.gameNumber ?? 0} : ${
                          campaign.name ?? campaignId
                        }`}
                      </div>
                      {isUsersTurn ? (
                        <div className="turn-label">{'> Save your turn'}</div>
                      ) : null}
                    </div>
                    <div className="campaign-meta">
                      <div>
                        <span>ACTIVE LORD</span>
                        <strong>{campaign.activePlayerDisplayName ?? 'unknown'}</strong>
                      </div>
                      <div>
                        <span>TURN</span>
                        <strong>{campaign.roundNumber ?? '-'}</strong>
                      </div>
                      <div>
                        <span>LAST</span>
                        <strong>{formatTimestamp(campaign.lastSyncedAt)}</strong>
                      </div>
                    </div>
                    <div className="campaign-status">
                      {campaign.error ?? campaign.status ?? 'waiting'}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <footer className="terminal-footer">
          <span>AUTH: {state.token ? 'DESKTOP TOKEN STORED' : 'DISCONNECTED'}</span>
          <span>CAMPAIGNS: {campaigns.length} MONITORED</span>
          <span>TIMER: {state.paused ? 'PAUSED' : 'ACTIVE'}</span>
        </footer>
      </section>
    </main>
  );
}
