import { describe, expect, it, vi } from 'vitest';
import { createDesktopSignIn } from './deepLinkAuth';

describe('desktop auth handoff', () => {
  it('does not open the web handoff when protocol registration fails', async () => {
    const openWebHandoff = vi.fn();
    const signIn = createDesktopSignIn({
      isRegistered: async () => false,
      openWebHandoff,
      register: async () => {
        throw new Error('registration failed');
      },
      webBaseUrl: 'http://localhost:3200',
    });

    await expect(signIn()).rejects.toThrow('registration failed');
    expect(openWebHandoff).not.toHaveBeenCalled();
  });

  it('does not open the web handoff when registration cannot be verified', async () => {
    const openWebHandoff = vi.fn();
    const signIn = createDesktopSignIn({
      isRegistered: async () => false,
      openWebHandoff,
      register: async () => null,
      webBaseUrl: 'http://localhost:3200',
    });

    await expect(signIn()).rejects.toThrow(
      'Desktop protocol registration did not complete.',
    );
    expect(openWebHandoff).not.toHaveBeenCalled();
  });

  it('opens the web handoff after protocol registration is verified', async () => {
    const openWebHandoff = vi.fn();
    const signIn = createDesktopSignIn({
      isRegistered: async () => true,
      openWebHandoff,
      register: async () => null,
      webBaseUrl: 'http://localhost:3200',
    });

    await signIn();

    expect(openWebHandoff).toHaveBeenCalledWith(
      'http://localhost:3200/api/auth/desktop?handoff=1',
    );
  });
});
