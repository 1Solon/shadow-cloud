import { describe, expect, it, vi } from "vitest";
import { createDesktopSignIn } from "./deepLinkAuth";

function createJsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

describe("desktop auth handoff", () => {
  it("opens the web handoff and resolves with the approved desktop token", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          handoffId: "handoff-1",
          pollSecret: "poll-secret",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          pollIntervalMs: 1_500,
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({ status: "approved", token: "desktop-token" }),
      );
    const openWebHandoff = vi.fn();
    const waitForPollInterval = vi.fn();

    const signIn = createDesktopSignIn({
      apiBaseUrl: "http://localhost:3001/",
      fetch,
      openWebHandoff,
      waitForPollInterval,
      webBaseUrl: "http://localhost:3200/",
    });

    await expect(signIn()).resolves.toBe("desktop-token");
    expect(openWebHandoff).toHaveBeenCalledWith(
      "http://localhost:3200/api/auth/desktop?handoff=handoff-1",
    );
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3001/v1/auth/desktop-handoffs",
      {
        method: "POST",
        cache: "no-store",
      },
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3001/v1/auth/desktop-handoffs/handoff-1/poll",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ pollSecret: "poll-secret" }),
        cache: "no-store",
      },
    );
    expect(waitForPollInterval).not.toHaveBeenCalled();
  });

  it("waits and polls again while the handoff is pending", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          handoffId: "handoff-1",
          pollSecret: "poll-secret",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          pollIntervalMs: 1_500,
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          status: "pending",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({ status: "approved", token: "desktop-token" }),
      );
    const waitForPollInterval = vi.fn(async () => undefined);

    const signIn = createDesktopSignIn({
      apiBaseUrl: "http://localhost:3001",
      fetch,
      openWebHandoff: vi.fn(),
      waitForPollInterval,
      webBaseUrl: "http://localhost:3200",
    });

    await expect(signIn()).resolves.toBe("desktop-token");
    expect(waitForPollInterval).toHaveBeenCalledWith(1_500);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not poll when opening the browser handoff fails", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      createJsonResponse({
        handoffId: "handoff-1",
        pollSecret: "poll-secret",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        pollIntervalMs: 1_500,
      }),
    );
    const openWebHandoff = vi.fn(async () => {
      throw new Error("browser failed");
    });

    const signIn = createDesktopSignIn({
      apiBaseUrl: "http://localhost:3001",
      fetch,
      openWebHandoff,
      webBaseUrl: "http://localhost:3200",
    });

    await expect(signIn()).rejects.toThrow("browser failed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws a useful error when the handoff expires", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          handoffId: "handoff-1",
          pollSecret: "poll-secret",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          pollIntervalMs: 1_500,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ status: "expired" }));

    const signIn = createDesktopSignIn({
      apiBaseUrl: "http://localhost:3001",
      fetch,
      openWebHandoff: vi.fn(),
      webBaseUrl: "http://localhost:3200",
    });

    await expect(signIn()).rejects.toThrow("Desktop sign-in expired.");
  });

  it("does not export protocol listener helpers", async () => {
    const auth = await import("./deepLinkAuth");
    const removedExports = [
      ["listen", "For", "Desktop", "Auth"].join(""),
      ["read", "Token", "From", "Deep", "Link"].join(""),
    ];

    for (const exportName of removedExports) {
      expect(exportName in auth).toBe(false);
    }
  });
});
