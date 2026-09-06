import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  getServerAuthSession: vi.fn(),
  createApiAccessToken: vi.fn(),
}));

import { createApiAccessToken, getServerAuthSession } from "@/auth";
import { GET, POST } from "./route";

const context = { params: Promise.resolve({ gameNumber: "42" }) };
const baseline = { campaignId: "campaign-1", revision: 7 };
const intent = {
  seatEntryIds: ["seat-1", "seat-2"],
  clearedSeatEntryIds: [],
  removedSeatEntryIds: [],
  activePlayerEntryId: "seat-2",
};

function post(payload: unknown) {
  return POST(
    new Request("http://localhost/api/games/42/seat-order", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer browser-override",
      },
      body: JSON.stringify(payload),
    }),
    context,
  );
}

describe("seat-order browser request", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: "overlord-1" },
      expires: "2099-01-01",
    });
    vi.mocked(createApiAccessToken).mockResolvedValue("session-token");
  });

  it.each([
    undefined,
    null,
    [[]],
    "7",
    {},
    { revision: 7 },
    { campaignId: "campaign-1" },
    { campaignId: "", revision: 7 },
    { campaignId: "  ", revision: 7 },
    { campaignId: 1, revision: 7 },
    { campaignId: "campaign-1", revision: -1 },
    { campaignId: "campaign-1", revision: 1.5 },
    { campaignId: "campaign-1", revision: "7" },
    { campaignId: "campaign-1", revision: Number.MAX_SAFE_INTEGER + 1 },
  ])(
    "rejects missing or malformed baseline %j with actionable reload guidance",
    async (invalidBaseline) => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json({ ok: true }));
      const response = await post({ ...intent, baseline: invalidBaseline });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        code: "SEAT_ORDER_BASELINE_REQUIRED",
        error: expect.stringMatching(/reload/i),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("forwards the submitted baseline unchanged using only server session credentials", async () => {
    const result = {
      ok: true,
      seatOrder: {
        seatOrderBaseline: { campaignId: "campaign-1", revision: 8 },
      },
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(result));

    const response = await post({
      ...intent,
      baseline,
      isShadowOverride: true,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3001/v1/games/42/seat-order",
      {
        method: "POST",
        headers: {
          authorization: "Bearer session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...intent, baseline }),
        cache: "no-store",
      },
    );
    await expect(response.json()).resolves.toEqual(result);
  });

  it.each([
    [400, "SEAT_ORDER_BASELINE_REQUIRED"],
    [409, "STALE_SEAT_ORDER"],
    [409, "TURN_MUTATION_CONFLICT"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [400, "INVALID_INTENT"],
  ])("preserves upstream status %s and code %s", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { message: ["Action rejected", "Reload if stale"], code },
        { status },
      ),
    );
    const response = await post({ ...intent, baseline });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      error: "Action rejected, Reload if stale",
      code,
    });
  });

  it.each([
    {},
    { seatEntryIds: [] },
    { seatEntryIds: null },
    { seatEntryIds: 42 },
    { seatEntryIds: [1] },
    { ...intent, clearedSeatEntryIds: false },
    { ...intent, clearedSeatEntryIds: [1] },
    { ...intent, removedSeatEntryIds: "seat-2" },
    { ...intent, removedSeatEntryIds: [1] },
    { ...intent, activePlayerEntryId: 42 },
  ])(
    "defers invalid intent %j to upstream so a valid stale baseline takes precedence",
    async (rawIntent) => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          Response.json(
            {
              code: "STALE_SEAT_ORDER",
              message: "Roster changed. Reload before saving.",
            },
            { status: 409 },
          ),
        );
      const response = await post({
        ...rawIntent,
        baseline,
        isShadowOverride: true,
      });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        code: "STALE_SEAT_ORDER",
        error: "Roster changed. Reload before saving.",
      });
      expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
        ...rawIntent,
        baseline,
      });
    },
  );

  it("loads an authoritative roster without caching or accepting browser credentials", async () => {
    const snapshot = {
      gameId: "campaign-1",
      players: [],
      seatOrderBaseline: baseline,
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(snapshot));
    const response = await GET(
      new Request("http://localhost/api/games/42/seat-order", {
        headers: { authorization: "Bearer browser-override" },
      }),
      context,
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3001/v1/games/42/seat-order",
      {
        method: "GET",
        headers: { authorization: "Bearer session-token" },
        cache: "no-store",
      },
    );
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  it.each([GET, POST])(
    "requires the server session for both seat-order methods",
    async (handler) => {
      vi.mocked(getServerAuthSession).mockResolvedValue(null);
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await handler(
        new Request("http://localhost/api/games/42/seat-order", {
          headers: { authorization: "Bearer browser-override" },
        }),
        context,
      );
      expect(response.status).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each([GET, POST])(
    "rejects unavailable server credentials for both methods",
    async (handler) => {
      vi.mocked(createApiAccessToken).mockRejectedValueOnce(
        new Error("credentials unavailable"),
      );
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await handler(
        new Request("http://localhost/api/games/42/seat-order"),
        context,
      );
      expect(response.status).toBe(500);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each([403, 404, 409, 500])(
    "preserves reload failure status %s and its code",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Response.json(
          { message: "Cannot load roster", code: "UPSTREAM_ERROR" },
          { status },
        ),
      );
      const response = await GET(
        new Request("http://localhost/api/games/42/seat-order"),
        context,
      );
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: "Cannot load roster",
        code: "UPSTREAM_ERROR",
      });
    },
  );

  it.each([0, Number.MAX_SAFE_INTEGER])(
    "forwards valid boundary revision %s",
    async (revision) => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json({ ok: true }));
      const response = await post({
        ...intent,
        baseline: { campaignId: "campaign-1", revision },
      });
      expect(response.status).toBe(200);
      expect(
        JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)).baseline,
      ).toEqual({ campaignId: "campaign-1", revision });
    },
  );
});
