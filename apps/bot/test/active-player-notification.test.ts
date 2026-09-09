import { once } from "node:events";
import type { Client, MessageCreateOptions } from "discord.js";
import { expect, it, vi } from "vitest";
import { startNotificationServer } from "../src/notification-server.js";

it("posts the corrected active player in the campaign thread", async () => {
  const send = vi.fn(async (_message: MessageCreateOptions) => ({}));
  const setName = vi.fn();
  const client = {
    channels: {
      fetch: vi.fn(async () => ({
        id: "thread-42",
        isThread: () => true,
        joinable: false,
        send,
        setName,
      })),
    },
  };
  const server = startNotificationServer(client as unknown as Client, {
    notificationPort: 0,
    notificationSecret: "test-secret",
    webBaseUrl: "https://shadow.example",
  })!;
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP listener");
    }
    const response = await fetch(
      `http://127.0.0.1:${address.port}/notify/active-player-changed`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shadow-cloud-notify-secret": "test-secret",
        },
        body: JSON.stringify({
          game: {
            id: "campaign",
            gameNumber: 42,
            slug: "ongoing",
            name: "Ongoing",
            discordThreadId: "thread-42",
          },
          turn: {
            roundNumber: 4,
            activePlayer: {
              id: "overlord",
              displayName: "Overlord",
              discordId: "discord-overlord",
              turnOrder: 1,
            },
          },
        }),
      },
    );
    expect(response.status).toBe(204);
    expect(client.channels.fetch).toHaveBeenCalledExactlyOnceWith("thread-42");
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]?.[0];
    expect(JSON.stringify(message)).toContain(
      "It is <@discord-overlord>'s turn!",
    );
    expect(JSON.stringify(message)).toContain(
      "https://shadow.example/games/42",
    );
    expect(JSON.stringify(message)).toContain("Round 4");
    expect(message).toMatchObject({
      allowedMentions: { users: ["discord-overlord"] },
    });
    expect(setName).not.toHaveBeenCalled();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
