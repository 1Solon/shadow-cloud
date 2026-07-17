import { MessageFlags } from "discord.js";
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
    expect(interaction.followUp).toHaveBeenCalledTimes(33);
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
