import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultDesktopSettings,
  defaultRemoteSettings,
  loadDesktopSettings,
  hasSeenDesktopHelp,
  loadRemoteSettings,
  markDesktopHelpSeen,
  saveDesktopSettings,
  saveRemoteSettings,
} from './desktopState';

const storeValues = new Map<string, unknown>();
const save = vi.fn(async () => undefined);

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (key: string) => storeValues.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      storeValues.set(key, value);
    }),
    save,
  })),
}));

describe('desktop help onboarding state', () => {
  beforeEach(() => {
    storeValues.clear();
    save.mockClear();
  });

  it('defaults to not seen, then persists the seen flag', async () => {
    await expect(hasSeenDesktopHelp()).resolves.toBe(false);

    await markDesktopHelpSeen();

    await expect(hasSeenDesktopHelp()).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });
});

describe('desktop remote settings', () => {
  beforeEach(() => {
    storeValues.clear();
    save.mockClear();
  });

  it('loads default remotes, then persists custom remotes', async () => {
    await expect(loadRemoteSettings()).resolves.toEqual(defaultRemoteSettings);

    const customRemotes = {
      apiBaseUrl: 'https://api.example.test',
      webBaseUrl: 'https://shadow.example.test',
    };

    await saveRemoteSettings(customRemotes);

    await expect(loadRemoteSettings()).resolves.toEqual(customRemotes);
    expect(save).toHaveBeenCalledOnce();
  });
});

describe('desktop app settings', () => {
  beforeEach(() => {
    storeValues.clear();
    save.mockClear();
  });

  it('defaults close-to-tray off, then persists the preference', async () => {
    await expect(loadDesktopSettings()).resolves.toEqual(defaultDesktopSettings);

    await saveDesktopSettings({
      ...defaultDesktopSettings,
      minimizeToTrayOnClose: true,
    });

    await expect(loadDesktopSettings()).resolves.toEqual({
      ...defaultDesktopSettings,
      minimizeToTrayOnClose: true,
    });
    expect(save).toHaveBeenCalledOnce();
  });
});
