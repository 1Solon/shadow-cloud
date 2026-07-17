import { ChannelType, MessageFlags } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { debugPreviewNames } from "../src/debug-previews.js";
import { createInteractionHandler } from "../src/interaction-handler.js";

const config = {
  apiBaseUrl: "https://api.shadow.example",
  webBaseUrl: "https://shadow.example",
};

function buildDebugInteraction(notifications: string | null) {
  return {
    isButton: () => false,
    isChatInputCommand: () => true,
    commandName: "debug",
    channel: null,
    channelId: "channel-1",
    guildId: "guild-1",
    guild: null,
    user: {
      id: "user-1",
      globalName: "Debug User",
      username: "debug-user",
    },
    options: {
      getString: (name: string) =>
        name === "notifications" ? notifications : null,
    },
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createInteractionHandler debug command", () => {
  it("delivers selected previews ephemerally without resolving a thread or calling the API", async () => {
    const interaction = buildDebugInteraction(
      "turn-reminder,turn-notification",
    );
    const client = {
      channels: { fetch: vi.fn(async () => null) },
    };
    const fetchMock = vi.fn(async () => {
      throw new Error("Debug command must not call fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    await createInteractionHandler(
      client as never,
      config,
    )(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.editReply.mock.calls[0]?.[0]).toMatchObject({
      flags: MessageFlags.IsComponentsV2,
    });
    expect(interaction.followUp.mock.calls[0]?.[0]).toMatchObject({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unknown preview names without emitting partial previews", async () => {
    const interaction = buildDebugInteraction("turn-reminder,missing");
    const client = {
      channels: { fetch: vi.fn(async () => null) },
    };

    await createInteractionHandler(
      client as never,
      config,
    )(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).not.toHaveBeenCalled();
    const rendered = JSON.stringify(interaction.editReply.mock.calls[0]?.[0]);
    expect(rendered).toContain("Unknown debug notification");
    expect(rendered).toContain("missing");
    expect(rendered).toContain(
      "Choose one or more registered notification names.",
    );
    expect(rendered).toContain("**Unknown** missing");
    expect(rendered).toContain("**Valid names**");
    for (const name of debugPreviewNames) {
      expect(rendered).toContain(name);
    }
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it("delivers every preview when the notification list is omitted", async () => {
    const interaction = buildDebugInteraction(null);
    const client = {
      channels: { fetch: vi.fn(async () => null) },
    };

    await createInteractionHandler(
      client as never,
      config,
    )(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledTimes(32);
    for (const [message] of interaction.followUp.mock.calls) {
      expect(message).toMatchObject({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      });
    }
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it("renders a bounded maximum-length unknown name", async () => {
    const unknownName = "x".repeat(1_000);
    const interaction = buildDebugInteraction(unknownName);
    const client = {
      channels: { fetch: vi.fn(async () => null) },
    };

    await createInteractionHandler(
      client as never,
      config,
    )(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const rendered = JSON.stringify(interaction.editReply.mock.calls[0]?.[0]);
    expect(rendered).toContain("Unknown debug notification");
    expect(rendered).toContain(unknownName);
  });

  it("contains preview delivery failures inside the debug interaction", async () => {
    const interaction = buildDebugInteraction(
      "turn-notification,turn-reminder",
    );
    interaction.followUp.mockRejectedValueOnce(new Error("Discord rejected"));
    const client = {
      channels: { fetch: vi.fn(async () => null) },
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      createInteractionHandler(client as never, config)(interaction as never),
    ).resolves.toBeUndefined();

    expect(interaction.editReply).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(interaction.editReply.mock.calls[1]?.[0])).toContain(
      "Shadow Cloud unavailable",
    );
  });
});

describe("createInteractionHandler skip command", () => {
  it("sends one public announcement before deleting the deferred reply", async () => {
    const send = vi.fn(async () => undefined);
    const channel = {
      id: "thread-1",
      name: "Debug World",
      parentId: "forum-1",
      parent: { type: ChannelType.GuildForum },
      isThread: () => true,
      joinable: false,
      send,
    };
    const interaction = {
      isButton: () => false,
      isChatInputCommand: () => true,
      commandName: "skip",
      channel,
      channelId: channel.id,
      guildId: "guild-1",
      guild: null,
      user: {
        id: "overlord-1",
        globalName: "Overlord",
        username: "overlord",
      },
      options: {},
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      deleteReply: vi.fn(async () => undefined),
    };
    const client = {
      channels: { fetch: vi.fn(async () => null) },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: "Debug World",
              skippedPlayer: {
                displayName: "Previous Player",
                turnOrder: 1,
              },
              nextPlayer: {
                displayName: "Solon",
                discordId: "user-2",
                turnOrder: 2,
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    );

    await createInteractionHandler(client as never, {
      ...config,
      botApiToken: "token",
    })(interaction as never);

    expect(send).toHaveBeenCalledOnce();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
    expect(send.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      interaction.deleteReply.mock.invocationCallOrder[0] ?? 0,
    );
    const renderedMessage = JSON.stringify(send.mock.calls[0]?.[0]);
    expect(renderedMessage).toContain("It is now <@user-2>'s turn!");
    expect(renderedMessage).toContain(
      "**Previous Player** (seat 1) was skipped in **Debug World**.",
    );
    expect(renderedMessage).not.toContain("**Seat** 2");
  });

  it("keeps the deferred reply when the public announcement fails", async () => {
    const send = vi.fn(async () => {
      throw new Error("Discord rejected the announcement");
    });
    const channel = {
      id: "thread-1",
      name: "Debug World",
      parentId: "forum-1",
      parent: { type: ChannelType.GuildForum },
      isThread: () => true,
      joinable: false,
      send,
    };
    const interaction = {
      isButton: () => false,
      isChatInputCommand: () => true,
      commandName: "skip",
      channel,
      channelId: channel.id,
      guildId: "guild-1",
      guild: null,
      user: {
        id: "overlord-1",
        globalName: "Overlord",
        username: "overlord",
      },
      options: {},
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      deleteReply: vi.fn(async () => undefined),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: "Debug World",
              skippedPlayer: {
                displayName: "Previous Player",
                turnOrder: 1,
              },
              nextPlayer: {
                displayName: "Solon",
                discordId: "user-2",
                turnOrder: 2,
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await createInteractionHandler(
      { channels: { fetch: vi.fn(async () => null) } } as never,
      { ...config, botApiToken: "token" },
    )(interaction as never);

    expect(send).toHaveBeenCalledOnce();
    expect(interaction.deleteReply).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(JSON.stringify(interaction.editReply.mock.calls[0]?.[0])).toContain(
      "Shadow Cloud unavailable",
    );
  });
});
