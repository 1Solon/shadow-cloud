import { jwtVerify } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("desktop API access token", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("AUTH_SECRET", "desktop-token-secret");
    vi.stubEnv("NEXTAUTH_SECRET", "desktop-token-secret");
  });

  it("includes the session profile image for desktop rendering", async () => {
    const { createDesktopApiAccessToken } = await import("./auth");

    const token = await createDesktopApiAccessToken({
      user: {
        id: "user-1",
        email: "solon@example.com",
        name: "Solon",
        image: "https://cdn.discordapp.com/avatars/user/avatar.png",
      },
    } as Parameters<typeof createDesktopApiAccessToken>[0]);

    expect(token).toBeTypeOf("string");

    const { payload } = await jwtVerify(
      token!,
      new TextEncoder().encode("desktop-token-secret"),
    );

    expect(payload.picture).toBe(
      "https://cdn.discordapp.com/avatars/user/avatar.png",
    );
  });
});
