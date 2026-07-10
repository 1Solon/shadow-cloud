import { afterEach, describe, expect, it, vi } from "vitest";
import { sendCommandRequest } from "../src/bot-api.js";

const config = {
  apiBaseUrl: "https://api.shadow.example",
  webBaseUrl: "https://shadow.example",
  botApiToken: "bot-token",
};

const channel = {
  id: "thread-1",
  parentId: "channel-1",
  name: "The Game",
};

function buildInitInteraction(timingOptions: Record<string, number | null>) {
  return {
    commandName: "init",
    user: {
      id: "organizer-1",
      globalName: "Organizer",
      username: "organizer",
    },
    guildId: "guild-1",
    options: {
      getString: (name: string) =>
        name === "title" ? " The Game " : null,
      getInteger: (name: string) => {
        if (name === "number") {
          return 42;
        }

        return timingOptions[name] ?? null;
      },
      getBoolean: () => null,
    },
  };
}

function mockFetch() {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("{}"),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendCommandRequest", () => {
  it("forwards supplied init timing options using camelCase API fields", async () => {
    const fetchMock = mockFetch();

    await sendCommandRequest(
      buildInitInteraction({
        turn_target_hours: 24,
        turn_reminder_grace_hours: 12,
        turn_reminder_repeat_hours: 6,
      }) as never,
      channel as never,
      config,
    );

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    if (!request) {
      throw new Error("Expected an init request");
    }
    expect(JSON.parse(request.body as string)).toMatchObject({
      turnTargetHours: 24,
      turnReminderGraceHours: 12,
      turnReminderRepeatHours: 6,
    });
  });

  it("omits init timing fields when Discord returns null", async () => {
    const fetchMock = mockFetch();

    await sendCommandRequest(
      buildInitInteraction({
        turn_target_hours: null,
        turn_reminder_grace_hours: null,
        turn_reminder_repeat_hours: null,
      }) as never,
      channel as never,
      config,
    );

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    if (!request) {
      throw new Error("Expected an init request");
    }
    const body = JSON.parse(request.body as string);
    expect(body).not.toHaveProperty("turnTargetHours");
    expect(body).not.toHaveProperty("turnReminderGraceHours");
    expect(body).not.toHaveProperty("turnReminderRepeatHours");
  });
});
