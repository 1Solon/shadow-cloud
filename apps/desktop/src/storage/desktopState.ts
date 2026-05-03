import { load } from '@tauri-apps/plugin-store';
import type { SyncState } from '@/sync/sync-engine';

const storeFileName = 'shadow-cloud-desktop.json';
const storeKey = 'sync-state';
const desktopHelpSeenKey = 'desktop-help-seen';
const remoteSettingsKey = 'remote-settings';
const desktopSettingsKey = 'desktop-settings';

export type RemoteSettings = {
  apiBaseUrl: string;
  webBaseUrl: string;
};

export type DesktopSettings = {
  minimizeToTrayOnClose: boolean;
};

export const defaultRemoteSettings: RemoteSettings = {
  apiBaseUrl:
    import.meta.env.VITE_SHADOW_CLOUD_API_URL ??
    'https://shadow-cloud.solonsstuff.com/',
  webBaseUrl:
    import.meta.env.VITE_SHADOW_CLOUD_WEB_URL ??
    'https://shadow-cloud.solonsstuff.com/',
};

export const defaultDesktopSettings: DesktopSettings = {
  minimizeToTrayOnClose: false,
};

export const defaultSyncState: SyncState = {
  saveRoot: null,
  token: null,
  syncIntervalSeconds: 120,
  paused: false,
  campaigns: {},
};

export async function loadSyncState() {
  const store = await load(storeFileName, { autoSave: true, defaults: {} });
  const storedState = await store.get<Partial<SyncState>>(storeKey);

  return {
    ...defaultSyncState,
    ...storedState,
    campaigns: storedState?.campaigns ?? {},
  };
}

export async function saveSyncState(state: SyncState) {
  const store = await load(storeFileName, { autoSave: true, defaults: {} });
  await store.set(storeKey, state);
  await store.save();
}

export async function hasSeenDesktopHelp() {
  const store = await load(storeFileName, { autoSave: true, defaults: {} });
  return (await store.get<boolean>(desktopHelpSeenKey)) === true;
}

export async function markDesktopHelpSeen() {
  const store = await load(storeFileName, { autoSave: true, defaults: {} });
  await store.set(desktopHelpSeenKey, true);
  await store.save();
}

export async function loadRemoteSettings() {
  const store = await load(storeFileName, { autoSave: true, defaults: {} });
  const storedSettings = await store.get<Partial<RemoteSettings>>(remoteSettingsKey);

  return {
    ...defaultRemoteSettings,
    ...storedSettings,
  };
}

export async function saveRemoteSettings(settings: RemoteSettings) {
  const store = await load(storeFileName, { autoSave: true, defaults: {} });
  await store.set(remoteSettingsKey, settings);
  await store.save();
}

export async function loadDesktopSettings() {
  const store = await load(storeFileName, { autoSave: true, defaults: {} });
  const storedSettings =
    await store.get<Partial<DesktopSettings>>(desktopSettingsKey);

  return {
    ...defaultDesktopSettings,
    ...storedSettings,
  };
}

export async function saveDesktopSettings(settings: DesktopSettings) {
  const store = await load(storeFileName, { autoSave: true, defaults: {} });
  await store.set(desktopSettingsKey, settings);
  await store.save();
}
