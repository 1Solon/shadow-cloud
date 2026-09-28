import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  createApiAccessToken: vi.fn(),
  getServerAuthSession: vi.fn(),
}));

vi.mock("@/lib/shadow-override", () => ({
  getShadowOverrideEnabled: vi.fn(),
}));

import { createApiAccessToken, getServerAuthSession } from "@/auth";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";
import { POST } from "./route";

const mockedCreateApiAccessToken = vi.mocked(createApiAccessToken);
const mockedGetServerAuthSession = vi.mocked(getServerAuthSession);
const mockedGetShadowOverrideEnabled = vi.mocked(getShadowOverrideEnabled);
const routeContext = {
  params: Promise.resolve({
    gameNumber: "22/plus?",
    fileVersionId: "file version/1?",
  }),
};

function authenticatedSession() {
  return {
    user: {
      id: "shadow-user",
      email: "overlord@example.com",
      name: "Overlord",
      isShadowOverride: true,
    },
  } as Awaited<ReturnType<typeof getServerAuthSession>>;
}

function rejectionRequest(body: unknown = { expectedSaveBaseline: "22:4:9" }) {
  return new Request(
    "http://shadow-cloud-web:3000/api/games/22/files/file-version-1/reject",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function signedInWithToken() {
  mockedGetServerAuthSession.mockResolvedValue(authenticatedSession());
  mockedGetShadowOverrideEnabled.mockResolvedValue(true);
  mockedCreateApiAccessToken.mockResolvedValue("test-token");
}

describe("/api/games/[gameNumber]/files/[fileVersionId]/reject", () => {
  beforeEach(() => {
    mockedCreateApiAccessToken.mockReset();
    mockedGetServerAuthSession.mockReset();
    mockedGetShadowOverrideEnabled.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("requires a signed-in user to reject a save", async () => {
    mockedGetServerAuthSession.mockResolvedValue(null);

    const response = await POST(rejectionRequest(), routeContext);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Sign in to reject saves.",
    });
    expect(mockedGetShadowOverrideEnabled).not.toHaveBeenCalled();
    expect(mockedCreateApiAccessToken).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns an authentication failure when it cannot sign an API token", async () => {
    mockedGetServerAuthSession.mockResolvedValue(authenticatedSession());
    mockedGetShadowOverrideEnabled.mockResolvedValue(true);
    mockedCreateApiAccessToken.mockRejectedValue(new Error("missing secret"));

    const response = await POST(rejectionRequest(), routeContext);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "API authentication is unavailable.",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("forwards the save baseline with the override-aware token and returns the new active player", async () => {
    signedInWithToken();
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json(
        {
          fileVersionId: "file-version-22",
          versionNumber: 4,
          gameNumber: 22,
          name: "Campaign 22",
          roundNumber: 3,
          activePlayer: {
            id: "seat-2",
            userId: "player-2",
            displayName: "Rhea",
            turnOrder: 2,
          },
        },
        { status: 201 },
      ),
    );

    const response = await POST(rejectionRequest(), routeContext);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      fileVersionId: "file-version-22",
      versionNumber: 4,
      roundNumber: 3,
      activePlayer: {
        id: "seat-2",
        userId: "player-2",
        displayName: "Rhea",
        turnOrder: 2,
      },
    });
    expect(mockedCreateApiAccessToken).toHaveBeenCalledWith(
      authenticatedSession(),
      { shadowOverrideEnabled: true },
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/v1/games/22%2Fplus%3F/files/file%20version%2F1%3F/reject",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ expectedSaveBaseline: "22:4:9" }),
        cache: "no-store",
      },
    );
  });

  it("omits a missing or malformed save baseline", async () => {
    signedInWithToken();
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({}, { status: 201 }),
    );

    await POST(rejectionRequest({ expectedSaveBaseline: 7 }), routeContext);

    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body).toBe("{}");
  });

  it.each([401, 403, 404, 409])(
    "preserves a backend rejection failure status of %i",
    async (status) => {
      signedInWithToken();
      vi.mocked(globalThis.fetch).mockResolvedValue(
        Response.json(
          { message: "Only the latest save can be rejected." },
          { status },
        ),
      );

      const response = await POST(rejectionRequest(), routeContext);

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: "Only the latest save can be rejected.",
      });
    },
  );

  it("flattens array backend validation messages", async () => {
    signedInWithToken();
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json(
        { message: ["expectedSaveBaseline must be a string"] },
        { status: 400 },
      ),
    );

    const response = await POST(rejectionRequest(), routeContext);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "expectedSaveBaseline must be a string",
    });
  });

  it("returns a gateway error when the rejection API request fails", async () => {
    signedInWithToken();
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("API unavailable"));

    const response = await POST(rejectionRequest(), routeContext);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "The save rejection could not reach the API.",
    });
  });
});
