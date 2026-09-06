import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  getServerAuthSession: vi.fn(async () => ({ user: { id: "overlord" } })),
  createApiAccessToken: vi.fn(async () => "api-token"),
}));

import { POST } from "./route";
import { getServerAuthSession } from "@/auth";

const transfer = () =>
  POST(
    new Request("http://web.test/api/games/43/transfer-host", {
      method: "POST",
      body: JSON.stringify({ targetPlayerEntryId: "seat-2" }),
    }),
    { params: Promise.resolve({ gameNumber: "43" }) },
  );

describe("transfer proxy outcome", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("labels a well-formed domain rejection as confirmed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ message: "Roster changed." }, { status: 409 }),
    );
    const response = await transfer();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Roster changed.",
      outcome: "rejected",
    });
  });

  it.each([
    () => Response.json({ message: "May have committed." }, { status: 503 }),
    () => new Response("gateway error", { status: 409 }),
    () => Response.json({ message: { unexpected: true } }, { status: 400 }),
    () => Response.json({ ok: true }),
    () => new Response(null, { status: 204 }),
  ])(
    "does not turn an uncertain response into a rejection or success",
    async (response) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
      const result = await transfer();
      expect(result.status).toBe(502);
      expect(await result.json()).toMatchObject({ outcome: "unconfirmed" });
    },
  );

  it("handles a lost upstream connection without claiming failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("fetch failed"),
    );
    const response = await transfer();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ outcome: "unconfirmed" });
  });

  it("forwards the existing successful transfer payload", async () => {
    const payload = {
      gameId: "campaign",
      gameNumber: 43,
      organizerId: "player-2",
      organizerDisplayName: "Player Two",
      player: { displayName: "Player Two", turnOrder: 2 },
      slug: "campaign",
      name: "Campaign",
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(payload));
    const response = await transfer();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/v1/games/43/transfer-host"),
      expect.objectContaining({
        headers: {
          authorization: "Bearer api-token",
          "content-type": "application/json",
        },
      }),
    );
  });

  it("rejects a missing session before forwarding", async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect((await transfer()).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
