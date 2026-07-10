import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  getServerAuthSession: vi.fn(),
  createApiAccessToken: vi.fn(),
}));

import { createApiAccessToken, getServerAuthSession } from "@/auth";
import { PATCH } from "./route";

const mockedGetServerAuthSession = vi.mocked(getServerAuthSession);
const mockedCreateApiAccessToken = vi.mocked(createApiAccessToken);

const routeContext = { params: Promise.resolve({ gameNumber: "22" }) };

function patchMetadata(payload: unknown) {
  return PATCH(
    new Request("http://shadow-cloud-web:3000/api/games/22/metadata", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    routeContext,
  );
}

describe("PATCH /api/games/[gameNumber]/metadata", () => {
  beforeEach(() => {
    mockedGetServerAuthSession.mockReset();
    mockedCreateApiAccessToken.mockReset();
    vi.restoreAllMocks();
  });

  it("requires an authenticated session before reading policy metadata", async () => {
    mockedGetServerAuthSession.mockResolvedValue(null);

    const response = await patchMetadata({ turnTargetHours: 1 });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Sign in to edit campaign details.",
    });
  });

  it.each([
    ["turnTargetHours", 1],
    ["turnTargetHours", Number.MAX_SAFE_INTEGER],
    ["turnReminderGraceHours", 1],
    ["turnReminderRepeatHours", Number.MAX_SAFE_INTEGER],
  ] as const)(
    "forwards a valid positive safe %s value of %s",
    async (field, value) => {
      mockedGetServerAuthSession.mockResolvedValue({
        user: { id: "overlord-1" },
      } as Awaited<ReturnType<typeof getServerAuthSession>>);
      mockedCreateApiAccessToken.mockResolvedValue("test-token");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ gameNumber: 22 }), { status: 200 }),
        );

      const payload = { [field]: value };
      const response = await patchMetadata(payload);

      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3001/v1/games/22/metadata",
        expect.objectContaining({
          body: JSON.stringify(payload),
          headers: {
            authorization: "Bearer test-token",
            "content-type": "application/json",
          },
          method: "PATCH",
        }),
      );
    },
  );

  it.each([
    "text",
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects %s for a duration", async (value) => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: { id: "overlord-1" },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);
    mockedCreateApiAccessToken.mockResolvedValue("test-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await patchMetadata({ turnTargetHours: value });

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean reminder status", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: { id: "overlord-1" },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);
    mockedCreateApiAccessToken.mockResolvedValue("test-token");

    const response = await patchMetadata({ turnRemindersEnabled: "false" });

    expect(response.status).toBe(400);
  });

  it("forwards false instead of dropping a disabled reminder status", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: { id: "overlord-1" },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);
    mockedCreateApiAccessToken.mockResolvedValue("test-token");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ gameNumber: 22 }), { status: 200 }),
      );

    const response = await patchMetadata({ turnRemindersEnabled: false });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3001/v1/games/22/metadata",
      expect.objectContaining({
        body: JSON.stringify({ turnRemindersEnabled: false }),
      }),
    );
  });

  it("propagates upstream policy authorization errors", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: { id: "player-1" },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);
    mockedCreateApiAccessToken.mockResolvedValue("test-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ message: "Campaign authority required." }),
        {
          status: 403,
        },
      ),
    );

    const response = await patchMetadata({ turnTargetHours: 24 });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Campaign authority required.",
    });
  });

  it("rejects array payloads", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: { id: "overlord-1" },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);
    mockedCreateApiAccessToken.mockResolvedValue("test-token");

    const response = await patchMetadata(["turnTargetHours", 24]);

    expect(response.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: { id: "overlord-1" },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);
    mockedCreateApiAccessToken.mockResolvedValue("test-token");
    const request = new Request(
      "http://shadow-cloud-web:3000/api/games/22/metadata",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    );

    const response = await PATCH(request, routeContext);

    expect(response.status).toBe(400);
  });
});
