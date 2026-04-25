import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  getServerAuthSession: vi.fn(),
  createApiAccessToken: vi.fn(),
}));

import { createApiAccessToken, getServerAuthSession } from "@/auth";
import { POST } from "./route";

const mockedGetServerAuthSession = vi.mocked(getServerAuthSession);
const mockedCreateApiAccessToken = vi.mocked(createApiAccessToken);

describe("POST /api/games/[gameNumber]/files", () => {
  beforeEach(() => {
    mockedGetServerAuthSession.mockReset();
    mockedCreateApiAccessToken.mockReset();
    vi.restoreAllMocks();
  });

  it("returns JSON with a relative redirect target after a successful upload", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "overlord@example.com",
        name: "Overlord",
      },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);
    mockedCreateApiAccessToken.mockResolvedValue("test-token");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    const formData = new FormData();
    formData.set(
      "file",
      new File(["shadow save"], "turn-22.se1", {
        type: "application/octet-stream",
      }),
      "turn-22.se1",
    );

    const request = new Request(
      "http://shadow-cloud-web:3000/api/games/22/files",
      {
        method: "POST",
        body: formData,
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ gameNumber: "22" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      ok: true,
      redirectTo: "/games/22?upload=success",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3001/v1/games/22/files",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer test-token" },
        cache: "no-store",
      }),
    );
  });
});
