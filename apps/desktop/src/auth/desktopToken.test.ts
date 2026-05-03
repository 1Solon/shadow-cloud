import { describe, expect, it } from "vitest";
import {
  decodeDesktopTokenAvatarUrl,
  decodeDesktopTokenDisplayName,
  decodeDesktopTokenSubject,
} from "./desktopToken";

function tokenWithPayload(payload: Record<string, unknown>) {
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `header.${encodedPayload}.signature`;
}

describe("desktop token decoding", () => {
  it("reads the sync user id from the token subject", () => {
    expect(
      decodeDesktopTokenSubject(tokenWithPayload({ sub: "user_123" })),
    ).toBe("user_123");
  });

  it("reads the desktop display name from the token name claim", () => {
    expect(
      decodeDesktopTokenDisplayName(
        tokenWithPayload({ sub: "user_123", name: "Solon" }),
      ),
    ).toBe("Solon");
  });

  it("falls back to email username when no display name is present", () => {
    expect(
      decodeDesktopTokenDisplayName(
        tokenWithPayload({ sub: "user_123", email: "solon@example.com" }),
      ),
    ).toBe("solon");
  });

  it("reads the avatar URL from the desktop token picture claim", () => {
    expect(
      decodeDesktopTokenAvatarUrl(
        tokenWithPayload({
          sub: "user_123",
          picture: "https://cdn.discordapp.com/avatars/user/avatar.png",
        }),
      ),
    ).toBe("https://cdn.discordapp.com/avatars/user/avatar.png");
  });
});
