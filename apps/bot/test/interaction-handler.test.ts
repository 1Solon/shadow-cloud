import {
  ChannelType,
  MessageFlags,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
} from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDebugPreviews,
  debugPreviewNames,
} from "../src/debug-previews.js";
import { createInteractionHandler } from "../src/interaction-handler.js";
import { buildRegistrationResponse } from "../src/notifications.js";
import { registrationResponses } from "./registration-fixtures.js";

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function buildRegistrationInteraction(customId: string) {
  return {
    isButton: () => true,
    customId,
    message: {
      id: "message-1",
      ...buildRegistrationResponse({
        mode: "live",
        requestId: "request-1",
        state: "pending",
        gameName: "Debug World",
        playerName: "Debug User",
        organizerDiscordId: "user-1",
      }),
    },
    user: { id: "acting-user-2" },
    deferUpdate: vi.fn(async () => undefined),
    editReply: vi.fn(
      async (_message: InteractionEditReplyOptions) => undefined,
    ),
    followUp: vi.fn(async (_message: InteractionReplyOptions) => undefined),
  };
}

describe("createInteractionHandler registration decisions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
  });

  it("edits the private submission reply before posting the complete live pending response", async () => {
    const channel = {
      id: "thread-1",
      name: "Debug World",
      parentId: "forum-1",
      parent: { type: ChannelType.GuildForum },
      isThread: () => true,
      joinable: false,
      send: vi.fn(async (_message: unknown) => undefined),
    };
    const interaction = {
      ...buildDebugInteraction(null),
      commandName: "register",
      channel,
      channelId: channel.id,
    };
    const fetchMock = vi.fn(async () => {
      expect(interaction.deferReply).toHaveBeenCalledExactlyOnceWith({
        flags: MessageFlags.Ephemeral,
      });
      return Response.json({
        requestId: "request-1",
        organizerDiscordId: "user-1",
        name: "Debug World",
        player: { displayName: "Debug User" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await createInteractionHandler({} as never, {
      ...config,
      botApiToken: "test-token",
    })(interaction as never);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(
      JSON.parse(JSON.stringify(interaction.editReply.mock.calls[0]?.[0])),
    ).toEqual({
      components: [
        {
          type: 17,
          accent_color: 16753920,
          components: [
            { type: 10, content: "## Registration submitted" },
            {
              type: 10,
              content:
                "Your request to join **Debug World** is waiting for the game overlord's approval.",
            },
            { type: 14, divider: true, spacing: 1 },
            { type: 10, content: "-# <t:1784289600:F>" },
          ],
        },
      ],
      flags: 32768,
    });
    expect(channel.send).toHaveBeenCalledOnce();
    expect(JSON.parse(JSON.stringify(channel.send.mock.calls[0]?.[0]))).toEqual(
      registrationResponses.pending,
    );
    expect(interaction.editReply.mock.invocationCallOrder[0]).toBeLessThan(
      channel.send.mock.invocationCallOrder[0]!,
    );
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it.each([
    ["sc_approve_request-1", "approve", "approved"],
    ["sc_reject_request-1", "reject", "rejected"],
  ] as const)(
    "acknowledges legacy %s before forwarding identities and updating the original",
    async (customId, action, state) => {
      const interaction = buildRegistrationInteraction(customId);
      const original = JSON.stringify(interaction.message);
      const acknowledgement = Promise.withResolvers<void>();
      const requested = Promise.withResolvers<void>();
      const remote = Promise.withResolvers<Response>();
      interaction.deferUpdate.mockImplementationOnce(async () => {
        await acknowledgement.promise;
      });
      const fetchMock = vi.fn<typeof fetch>(() => {
        requested.resolve();
        return remote.promise;
      });
      vi.stubGlobal("fetch", fetchMock);

      const handling = createInteractionHandler({} as never, {
        ...config,
        botApiToken: "test-token",
      })(interaction as never);
      expect(interaction.deferUpdate).toHaveBeenCalledExactlyOnceWith();
      expect(fetchMock).not.toHaveBeenCalled();
      acknowledgement.resolve();
      await requested.promise;

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `https://api.shadow.example/v1/games/registration-requests/request-1/${action}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-shadow-cloud-bot-token": "test-token",
          },
          body: JSON.stringify({
            discordMessageId: "message-1",
            approverDiscordId: "acting-user-2",
          }),
        },
      );
      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(interaction.followUp).not.toHaveBeenCalled();
      expect(JSON.stringify(interaction.message)).toBe(original);

      remote.resolve(
        Response.json({
          name: "Debug World",
          gameNumber: 42,
          player: { displayName: "Debug User", turnOrder: 2 },
        }),
      );
      await handling;

      expect(interaction.editReply).toHaveBeenCalledOnce();
      expect(
        JSON.parse(JSON.stringify(interaction.editReply.mock.calls[0]?.[0])),
      ).toEqual(registrationResponses[state]);
      expect(interaction.followUp).not.toHaveBeenCalled();
    },
  );

  it.each([
    "debug_approve",
    "debug_reject",
    "unknown_button",
    "debug_sc_approve_request-1",
  ])(
    "ignores %s without acknowledgement, remote work, or delivery",
    async (customId) => {
      const interaction = buildRegistrationInteraction(customId);
      const original = JSON.stringify(interaction.message);
      const fetchMock = vi.fn(() => {
        throw new Error("Inert controls must not call fetch");
      });
      vi.stubGlobal("fetch", fetchMock);

      await createInteractionHandler({} as never, config)(interaction as never);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(interaction.followUp).not.toHaveBeenCalled();
      expect(JSON.stringify(interaction.message)).toBe(original);
    },
  );

  it.each([
    [
      "approve",
      "Approval failed",
      "Shadow Cloud could not approve this registration.",
    ],
    [
      "reject",
      "Rejection failed",
      "Shadow Cloud could not reject this registration.",
    ],
  ] as const)(
    "keeps original controls and reports a rejected %s decision privately",
    async (action, headline, message) => {
      const interaction = buildRegistrationInteraction(
        `sc_${action}_request-1`,
      );
      const original = JSON.stringify(interaction.message);
      const fetchMock = vi.fn(async () => {
        expect(interaction.deferUpdate).toHaveBeenCalledOnce();
        return Response.json(
          { message: ["Not the Overlord", "Request is no longer pending"] },
          { status: 409 },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await createInteractionHandler({} as never, config)(interaction as never);

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(JSON.stringify(interaction.message)).toBe(original);
      expect(interaction.followUp).toHaveBeenCalledOnce();
      expect(
        JSON.parse(JSON.stringify(interaction.followUp.mock.calls[0]?.[0])),
      ).toEqual({
        components: [
          {
            type: 17,
            accent_color: 16753920,
            components: [
              { type: 10, content: `## ${headline}` },
              { type: 10, content: message },
              {
                type: 10,
                content:
                  "**Reason:** Not the Overlord, Request is no longer pending",
              },
              { type: 14, divider: true, spacing: 1 },
              { type: 10, content: "-# <t:1784289600:F>" },
            ],
          },
        ],
        flags: 32832,
      });
    },
  );

  it.each(["approve", "reject"])(
    "keeps original controls and reports a transport failure privately for %s",
    async (action) => {
      const interaction = buildRegistrationInteraction(
        `sc_${action}_request-1`,
      );
      const original = JSON.stringify(interaction.message);
      const fetchMock = vi.fn(async () => {
        expect(interaction.deferUpdate).toHaveBeenCalledOnce();
        throw new Error("Connection reset");
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      await createInteractionHandler({} as never, config)(interaction as never);

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(JSON.stringify(interaction.message)).toBe(original);
      expect(interaction.followUp).toHaveBeenCalledOnce();
      expect(
        JSON.parse(JSON.stringify(interaction.followUp.mock.calls[0]?.[0])),
      ).toEqual({
        components: [
          {
            type: 17,
            accent_color: 16753920,
            components: [
              { type: 10, content: "## Shadow Cloud unavailable" },
              {
                type: 10,
                content:
                  "Unable to reach the Shadow Cloud API right now. Please try again.",
              },
              { type: 14, divider: true, spacing: 1 },
              { type: 10, content: "-# <t:1784289600:F>" },
            ],
          },
        ],
        flags: 32832,
      });
    },
  );
});

describe("createInteractionHandler debug command", () => {
  it("delivers registration previews in registry order with edit versus private follow-up flags", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const interaction = buildDebugInteraction(
      "registration-rejected,registration-approved,registration-approval",
    );
    const fetchMock = vi.fn(() => {
      throw new Error("Previews must not call fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const [pending, approved, rejected] = buildDebugPreviews(
      [
        "registration-approval",
        "registration-approved",
        "registration-rejected",
      ],
      {
        userId: "user-1",
        userDisplayName: "Debug User",
        webBaseUrl: config.webBaseUrl,
      },
    );

    await createInteractionHandler({} as never, config)(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledExactlyOnceWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(
      JSON.parse(JSON.stringify(interaction.editReply.mock.calls[0]?.[0])),
    ).toEqual(
      JSON.parse(JSON.stringify({ ...pending?.message, flags: 32768 })),
    );
    expect(interaction.followUp).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(
        JSON.stringify(
          interaction.followUp.mock.calls.map(([message]) => message),
        ),
      ),
    ).toEqual(
      JSON.parse(JSON.stringify([approved?.message, rejected?.message])),
    );
    expect(interaction.deferReply.mock.invocationCallOrder[0]).toBeLessThan(
      interaction.editReply.mock.invocationCallOrder[0]!,
    );
    expect(interaction.editReply.mock.invocationCallOrder[0]).toBeLessThan(
      interaction.followUp.mock.invocationCallOrder[0]!,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

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
