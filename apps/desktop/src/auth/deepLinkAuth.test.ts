import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopSignIn } from "./deepLinkAuth";

describe("desktop auth handoff", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not open the web handoff when protocol registration fails", async () => {
    const openWebHandoff = vi.fn();
    const signIn = createDesktopSignIn({
      isRegistered: async () => false,
      openWebHandoff,
      register: async () => {
        throw new Error("registration failed");
      },
      webBaseUrl: "http://localhost:3200",
    });

    await expect(signIn()).rejects.toThrow("registration failed");
    expect(openWebHandoff).not.toHaveBeenCalled();
  });

  it("opens the web handoff when the protocol is already registered", async () => {
    const openWebHandoff = vi.fn();
    const signIn = createDesktopSignIn({
      isRegistered: async () => true,
      openWebHandoff,
      register: async () => {
        throw new Error("runtime registration failed");
      },
      webBaseUrl: "http://localhost:3200",
    });

    await signIn();

    expect(openWebHandoff).toHaveBeenCalledWith(
      "http://localhost:3200/api/auth/desktop?handoff=1",
    );
  });

  it("does not wait for runtime registration when the protocol is already registered", async () => {
    const openWebHandoff = vi.fn();
    const signIn = createDesktopSignIn({
      isRegistered: async () => true,
      openWebHandoff,
      register: () => new Promise(() => {}),
      webBaseUrl: "http://localhost:3200",
    });

    await signIn();

    expect(openWebHandoff).toHaveBeenCalledWith(
      "http://localhost:3200/api/auth/desktop?handoff=1",
    );
  });

  it("opens the web handoff when protocol registration does not answer", async () => {
    vi.useFakeTimers();

    const openWebHandoff = vi.fn();
    const signIn = createDesktopSignIn({
      isRegistered: () => new Promise(() => {}),
      openWebHandoff,
      register: async () => null,
      webBaseUrl: "http://localhost:3200",
    });

    const signInPromise = signIn();

    await vi.advanceTimersByTimeAsync(1_500);
    await signInPromise;

    expect(openWebHandoff).toHaveBeenCalledWith(
      "http://localhost:3200/api/auth/desktop?handoff=1",
    );
  });

  it("does not open the web handoff when registration cannot be verified", async () => {
    const openWebHandoff = vi.fn();
    const signIn = createDesktopSignIn({
      isRegistered: async () => false,
      openWebHandoff,
      register: async () => null,
      webBaseUrl: "http://localhost:3200",
    });

    await expect(signIn()).rejects.toThrow(
      "Desktop protocol registration did not complete.",
    );
    expect(openWebHandoff).not.toHaveBeenCalled();
  });

  it("opens the web handoff after protocol registration is verified", async () => {
    const openWebHandoff = vi.fn();
    const signIn = createDesktopSignIn({
      isRegistered: async () => true,
      openWebHandoff,
      register: async () => null,
      webBaseUrl: "http://localhost:3200",
    });

    await signIn();

    expect(openWebHandoff).toHaveBeenCalledWith(
      "http://localhost:3200/api/auth/desktop?handoff=1",
    );
  });
});
