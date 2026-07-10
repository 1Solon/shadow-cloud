import { describe, expect, it } from "vitest";
import { buildSaveReplacedNotificationMessage } from "../src/notifications.js";

const saveReplacedPayload = {
  game: {
    id: "game-1",
    gameNumber: 42,
    slug: "the-game",
    name: "The Game",
    discordThreadId: "thread-1",
  },
  replacement: {
    versionId: "version-1",
    versionNumber: 7,
    originalName: "42-T4-S2-Other.se1",
    replacedAt: "2026-07-10T14:30:00.000Z",
    replacedBy: {
      id: "user-1",
      displayName: "Solon",
      discordId: "discord-1",
    },
  },
};

describe("buildSaveReplacedNotificationMessage", () => {
  it("builds a correction message without turn instructions", () => {
    const message = JSON.stringify(
      buildSaveReplacedNotificationMessage(
        saveReplacedPayload,
        "https://shadow.example",
      ),
    );

    expect(message).toContain("Save corrected");
    expect(message).toContain("The Game");
    expect(message).toContain("42-T4-S2-Other.se1");
    expect(message).toContain("<@discord-1>");
    expect(message).toContain("<t:1783693800:F>");
    expect(message).not.toContain("active player");
    expect(message).not.toContain("next player");
    expect(message).not.toContain("current turn");
    expect(message).not.toContain("completed turn");
    expect(message).not.toContain("It is");
  });
});
