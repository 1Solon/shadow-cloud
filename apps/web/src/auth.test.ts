import { jwtVerify } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("API access token", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("AUTH_SECRET", "api-token-secret");
    vi.stubEnv("NEXTAUTH_SECRET", "api-token-secret");
  });

  it("includes the override claim only for a capable session with an enabled cookie", async () => {
    const { createApiAccessToken } = await import("./auth");
    const shadowSession = {
      user: {
        id: "shadow-user",
        isShadowOverride: true,
      },
    } as Parameters<typeof createApiAccessToken>[0];
    const normalSession = {
      user: {
        id: "normal-user",
        isShadowOverride: false,
      },
    } as Parameters<typeof createApiAccessToken>[0];
    const secret = new TextEncoder().encode("api-token-secret");

    const enabled = await createApiAccessToken(shadowSession, {
      shadowOverrideEnabled: true,
    });
    const disabled = await createApiAccessToken(shadowSession, {
      shadowOverrideEnabled: false,
    });
    const incapable = await createApiAccessToken(normalSession, {
      shadowOverrideEnabled: true,
    });

    await expect(jwtVerify(enabled!, secret)).resolves.toMatchObject({
      payload: { shadowOverrideEnabled: true },
    });
    await expect(jwtVerify(disabled!, secret)).resolves.toMatchObject({
      payload: { shadowOverrideEnabled: false },
    });
    await expect(jwtVerify(incapable!, secret)).resolves.toMatchObject({
      payload: { shadowOverrideEnabled: false },
    });
  });
});
