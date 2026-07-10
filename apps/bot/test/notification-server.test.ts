import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { startNotificationServer } from "../src/notification-server";

const httpMock = vi.hoisted(() => {
  let handler:
    ((request: unknown, response: unknown) => void | Promise<void>) | null =
    null;
  const server = {
    listen: vi.fn((_port: number, callback?: () => void) => callback?.()),
    on: vi.fn(),
  };

  return {
    createServer: vi.fn((nextHandler) => {
      handler = nextHandler;
      return server;
    }),
    getHandler: () => handler,
    server,
  };
});

const threadNameMock = vi.hoisted(() => ({
  ensureShadowCloudTag: vi.fn(async () => ({ status: "applied" })),
  renameThreadIfNeeded: vi.fn(async () => undefined),
}));

vi.mock("node:http", () => ({
  createServer: httpMock.createServer,
}));

vi.mock("../src/thread-name.js", () => ({
  SHADOW_CLOUD_TAG_NAME: "Shadow Cloud",
  ensureShadowCloudTag: threadNameMock.ensureShadowCloudTag,
  renameThreadIfNeeded: threadNameMock.renameThreadIfNeeded,
}));

function buildRequest(
  url: string,
  payload: unknown,
  notificationSecret = "secret",
) {
  const body = Buffer.from(
    typeof payload === "string" ? payload : JSON.stringify(payload),
  );

  return Object.assign(new EventEmitter(), {
    method: "POST",
    url,
    headers: {
      "x-shadow-cloud-notify-secret": notificationSecret,
    },
    async *[Symbol.asyncIterator]() {
      yield body;
    },
  });
}

function buildResponse() {
  const response = {
    statusCode: undefined as number | undefined,
    body: undefined as string | undefined,
    writeHead: vi.fn((statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    }),
    end: vi.fn((body?: string) => {
      response.body = body;
      return response;
    }),
  };

  return response;
}

function buildClient(thread: unknown) {
  return {
    channels: {
      fetch: vi.fn(async () => thread),
    },
  };
}

const gameInitializedPayload = {
  game: {
    id: "game-1",
    slug: "the-game",
    name: "The Game",
    threadName: "42 - The Game",
    gameNumber: 42,
    discordThreadId: "thread-1",
    playerCount: 4,
    hasAiPlayers: false,
    dlcMode: null,
    gameMode: null,
    techLevel: null,
    zoneCount: null,
    armyCount: null,
  },
  organizer: {
    id: "user-1",
    displayName: "Solon",
    discordId: "discord-1",
  },
};

const saveUploadedPayload = {
  game: {
    id: "game-1",
    gameNumber: 42,
    slug: "the-game",
    name: "The Game",
    discordThreadId: "thread-1",
  },
  upload: {
    versionId: "version-1",
    versionNumber: 1,
    originalName: "turn.trn",
    uploadedAt: "2026-05-11T12:00:00.000Z",
    uploadedBy: {
      id: "user-1",
      displayName: "Solon",
      discordId: "discord-1",
    },
  },
  turn: {
    roundNumber: 1,
    roundAdvanced: true,
    activePlayer: {
      id: "user-2",
      displayName: "Next Player",
      discordId: "discord-2",
      turnOrder: 2,
    },
  },
  players: [],
};

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

const turnNudgePayload = {
  game: {
    id: "game-1",
    gameNumber: 42,
    slug: "the-game",
    name: "The Game",
    discordThreadId: "thread-1",
  },
  turnRecord: {
    id: "turn-1",
    roundNumber: 3,
    startedAt: "2026-07-10T12:00:00.000Z",
    elapsedHours: 25,
    targetHours: 24,
    activePlayer: {
      id: "user-2",
      displayName: "Next Player",
      discordId: "discord-2",
      turnOrder: 2,
    },
  },
};

describe("startNotificationServer", () => {
  it("pins the game-initialized notification message", async () => {
    const pin = vi.fn(async () => undefined);
    const thread = {
      id: "thread-1",
      isThread: () => true,
      joinable: false,
      send: vi.fn(async () => ({ pin })),
    };
    const client = buildClient(thread);

    startNotificationServer(client as never, {
      notificationPort: 3011,
      notificationSecret: "secret",
      webBaseUrl: "https://shadow.example",
    });

    const response = buildResponse();
    await httpMock.getHandler()?.(
      buildRequest("/notify/game-initialized", gameInitializedPayload),
      response,
    );

    expect(thread.send).toHaveBeenCalledOnce();
    expect(pin).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(204);
  });

  it("does not fail game-initialized delivery when pinning is rejected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pinError = new Error("Missing permissions");
    const thread = {
      id: "thread-1",
      isThread: () => true,
      joinable: false,
      send: vi.fn(async () => ({
        pin: vi.fn(async () => {
          throw pinError;
        }),
      })),
    };
    const client = buildClient(thread);

    startNotificationServer(client as never, {
      notificationPort: 3011,
      notificationSecret: "secret",
      webBaseUrl: "https://shadow.example",
    });

    const response = buildResponse();
    await httpMock.getHandler()?.(
      buildRequest("/notify/game-initialized", gameInitializedPayload),
      response,
    );

    expect(response.statusCode).toBe(204);
    expect(warn).toHaveBeenCalledWith(
      "Skipping pin for game-initialized notification The Game (thread-1) because Discord rejected the update.",
      pinError,
    );
  });

  it("does not pin save-uploaded notification messages", async () => {
    const pin = vi.fn(async () => undefined);
    const thread = {
      id: "thread-1",
      isThread: () => true,
      joinable: false,
      send: vi.fn(async () => ({ pin })),
    };
    const client = buildClient(thread);

    startNotificationServer(client as never, {
      notificationPort: 3011,
      notificationSecret: "secret",
      webBaseUrl: "https://shadow.example",
    });

    const response = buildResponse();
    await httpMock.getHandler()?.(
      buildRequest("/notify/save-uploaded", saveUploadedPayload),
      response,
    );

    expect(thread.send).toHaveBeenCalledOnce();
    expect(pin).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(204);
  });

  it("delivers save-replaced notifications without renaming, tagging, or pinning", async () => {
    const pin = vi.fn(async () => undefined);
    const thread = {
      id: "thread-1",
      isThread: () => true,
      joinable: false,
      send: vi.fn(async () => ({ pin })),
    };
    const client = buildClient(thread);

    startNotificationServer(client as never, {
      notificationPort: 3011,
      notificationSecret: "secret",
      webBaseUrl: "https://shadow.example",
    });

    const response = buildResponse();
    await httpMock.getHandler()?.(
      buildRequest("/notify/save-replaced", saveReplacedPayload),
      response,
    );

    expect(thread.send).toHaveBeenCalledOnce();
    expect(pin).not.toHaveBeenCalled();
    expect(threadNameMock.renameThreadIfNeeded).not.toHaveBeenCalled();
    expect(threadNameMock.ensureShadowCloudTag).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(204);
  });

  it("delivers authenticated turn nudges without renaming, tagging, or pinning", async () => {
    const pin = vi.fn(async () => undefined);
    const thread = {
      id: "thread-1",
      isThread: () => true,
      joinable: false,
      send: vi.fn(async () => ({ pin })),
    };
    const client = buildClient(thread);

    startNotificationServer(client as never, {
      notificationPort: 3011,
      notificationSecret: "secret",
      webBaseUrl: "https://shadow.example",
    });

    const response = buildResponse();
    await httpMock.getHandler()?.(
      buildRequest("/notify/turn-nudge", turnNudgePayload),
      response,
    );

    expect(thread.send).toHaveBeenCalledOnce();
    expect(pin).not.toHaveBeenCalled();
    expect(threadNameMock.renameThreadIfNeeded).not.toHaveBeenCalled();
    expect(threadNameMock.ensureShadowCloudTag).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(204);
  });

  it("rejects turn nudges with an invalid notification secret", async () => {
    startNotificationServer(buildClient(null) as never, {
      notificationPort: 3011,
      notificationSecret: "secret",
      webBaseUrl: "https://shadow.example",
    });

    const response = buildResponse();
    await httpMock.getHandler()?.(
      buildRequest("/notify/turn-nudge", turnNudgePayload, "wrong-secret"),
      response,
    );

    expect(response.statusCode).toBe(401);
  });

  it("accepts turn nudges without a configured thread", async () => {
    const client = buildClient(null);
    startNotificationServer(client as never, {
      notificationPort: 3011,
      notificationSecret: "secret",
      webBaseUrl: "https://shadow.example",
    });

    const response = buildResponse();
    await httpMock.getHandler()?.(
      buildRequest("/notify/turn-nudge", {
        ...turnNudgePayload,
        game: { ...turnNudgePayload.game, discordThreadId: null },
      }),
      response,
    );

    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(202);
  });

  it("returns an error for malformed turn-nudge JSON", async () => {
    startNotificationServer(buildClient(null) as never, {
      notificationPort: 3011,
      notificationSecret: "secret",
      webBaseUrl: "https://shadow.example",
    });

    const response = buildResponse();
    await httpMock.getHandler()?.(
      buildRequest("/notify/turn-nudge", "{invalid JSON"),
      response,
    );

    expect(response.statusCode).toBe(500);
  });
});
