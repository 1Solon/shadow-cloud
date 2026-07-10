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
import { GET, PUT } from "./route";

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

function replacementRequest(file?: File) {
  const formData = new FormData();

  if (file) {
    formData.set("file", file, file.name);
  }

  return new Request(
    "http://shadow-cloud-web:3000/api/games/22/files/file-version-1",
    {
      method: "PUT",
      body: formData,
    },
  );
}

describe("/api/games/[gameNumber]/files/[fileVersionId]", () => {
  beforeEach(() => {
    mockedCreateApiAccessToken.mockReset();
    mockedGetServerAuthSession.mockReset();
    mockedGetShadowOverrideEnabled.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("requires a signed-in user to replace a save", async () => {
    mockedGetServerAuthSession.mockResolvedValue(null);

    const response = await PUT(replacementRequest(), routeContext);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Sign in to replace save files.",
    });
    expect(mockedGetShadowOverrideEnabled).not.toHaveBeenCalled();
    expect(mockedCreateApiAccessToken).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns an authentication failure when it cannot sign an API token", async () => {
    mockedGetServerAuthSession.mockResolvedValue(authenticatedSession());
    mockedGetShadowOverrideEnabled.mockResolvedValue(true);
    mockedCreateApiAccessToken.mockRejectedValue(new Error("missing secret"));

    const response = await PUT(replacementRequest(), routeContext);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "API authentication is unavailable.",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("requires a non-empty replacement file", async () => {
    mockedGetServerAuthSession.mockResolvedValue(authenticatedSession());
    mockedGetShadowOverrideEnabled.mockResolvedValue(true);
    mockedCreateApiAccessToken.mockResolvedValue("test-token");

    const response = await PUT(replacementRequest(), routeContext);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Choose a replacement save file.",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("forwards an authenticated replacement multipart request and returns replacement fields", async () => {
    const file = new File(["replacement save"], "turn-22.se1", {
      type: "application/octet-stream",
    });
    mockedGetServerAuthSession.mockResolvedValue(authenticatedSession());
    mockedGetShadowOverrideEnabled.mockResolvedValue(true);
    mockedCreateApiAccessToken.mockResolvedValue("test-token");
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({
        fileVersionId: "file-version-22",
        versionNumber: 4,
        originalName: "22-T8-S2-Player2.se1",
        replacedAt: "2026-07-10T12:34:56.000Z",
        replacedByDisplayName: "Overlord",
      }),
    );

    const response = await PUT(replacementRequest(file), routeContext);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      fileVersionId: "file-version-22",
      versionNumber: 4,
      originalName: "22-T8-S2-Player2.se1",
      replacedAt: "2026-07-10T12:34:56.000Z",
      replacedByDisplayName: "Overlord",
    });
    expect(mockedCreateApiAccessToken).toHaveBeenCalledWith(
      authenticatedSession(),
      { shadowOverrideEnabled: true },
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/v1/games/22%2Fplus%3F/files/file%20version%2F1%3F",
      expect.objectContaining({
        method: "PUT",
        headers: { authorization: "Bearer test-token" },
        cache: "no-store",
      }),
    );

    const requestInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
    expect(requestInit?.body).toBeInstanceOf(FormData);
    expect((requestInit?.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it.each([400, 403, 404, 409])(
    "preserves a backend replacement failure status of %i",
    async (status) => {
      mockedGetServerAuthSession.mockResolvedValue(authenticatedSession());
      mockedGetShadowOverrideEnabled.mockResolvedValue(true);
      mockedCreateApiAccessToken.mockResolvedValue("test-token");
      vi.mocked(globalThis.fetch).mockResolvedValue(
        Response.json({ message: "The save cannot be replaced." }, { status }),
      );

      const response = await PUT(
        replacementRequest(new File(["replacement"], "turn-22.se1")),
        routeContext,
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: "The save cannot be replaced.",
      });
    },
  );

  it("flattens array backend validation messages", async () => {
    mockedGetServerAuthSession.mockResolvedValue(authenticatedSession());
    mockedGetShadowOverrideEnabled.mockResolvedValue(true);
    mockedCreateApiAccessToken.mockResolvedValue("test-token");
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json(
        { message: ["The save is too large.", "The save is invalid."] },
        { status: 400 },
      ),
    );

    const response = await PUT(
      replacementRequest(new File(["replacement"], "turn-22.se1")),
      routeContext,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The save is too large., The save is invalid.",
    });
  });

  it("returns a gateway error when the replacement API request fails", async () => {
    mockedGetServerAuthSession.mockResolvedValue(authenticatedSession());
    mockedGetShadowOverrideEnabled.mockResolvedValue(true);
    mockedCreateApiAccessToken.mockResolvedValue("test-token");
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("API unavailable"));

    const response = await PUT(
      replacementRequest(new File(["replacement"], "turn-22.se1")),
      routeContext,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "The save replacement could not reach the API.",
    });
  });

  it("streams downloads without invoking authentication helpers", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("save contents", {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": 'attachment; filename="turn-22.se1"',
          "content-length": "13",
          "last-modified": "Fri, 10 Jul 2026 12:00:00 GMT",
        },
      }),
    );

    const response = await GET(
      new Request(
        "http://shadow-cloud-web:3000/api/games/22/files/file-version-1",
      ),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="turn-22.se1"',
    );
    expect(response.headers.get("content-length")).toBe("13");
    expect(response.headers.get("last-modified")).toBe(
      "Fri, 10 Jul 2026 12:00:00 GMT",
    );
    await expect(response.text()).resolves.toBe("save contents");
    expect(mockedGetServerAuthSession).not.toHaveBeenCalled();
    expect(mockedGetShadowOverrideEnabled).not.toHaveBeenCalled();
    expect(mockedCreateApiAccessToken).not.toHaveBeenCalled();
  });
});
