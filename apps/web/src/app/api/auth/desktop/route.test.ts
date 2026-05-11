import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  createInternalApiToken: vi.fn(),
  getServerAuthSession: vi.fn(),
}));

import { createInternalApiToken, getServerAuthSession } from "@/auth";
import { GET, POST } from "./route";

const mockedCreateInternalApiToken = vi.mocked(createInternalApiToken);
const mockedGetServerAuthSession = vi.mocked(getServerAuthSession);

describe("/api/auth/desktop", () => {
  beforeEach(() => {
    vi.stubEnv("SHADOW_CLOUD_API_URL", "http://localhost:3001");
    mockedCreateInternalApiToken.mockReset();
    mockedGetServerAuthSession.mockReset();
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  it("shows instructions when opened without a handoff id", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);

    const response = await GET(
      new Request("http://localhost:3200/api/auth/desktop"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain(
      "Open Shadow-Cloud Desktop",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("starts Discord sign-in with a callback that preserves the handoff id", async () => {
    mockedGetServerAuthSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost:3200/api/auth/desktop?handoff=abc123"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const body = await response.text();

    expect(body).toContain('method="POST"');
    expect(body).toContain('action="/api/auth/signin/discord"');
    expect(body).toContain('name="callbackUrl"');
    expect(body).toContain("/api/auth/desktop?handoff=abc123");
    expect(body).not.toContain("/api/auth/signin/discord?callbackUrl=");
  });

  it("renders an approval form for an authenticated handoff without approving it", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "solon@example.com",
        name: "Solon",
        image: "https://cdn.discordapp.com/avatar.png",
      },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);

    const response = await GET(
      new Request("http://localhost:3200/api/auth/desktop?handoff=abc123"),
    );

    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).toContain("Approve Shadow-Cloud Desktop");
    expect(body).toContain('method="POST"');
    expect(body).toContain("/api/auth/desktop?handoff=abc123");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("approves an authenticated same-origin POST through the API", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "solon@example.com",
        name: "Solon",
        image: "https://cdn.discordapp.com/avatar.png",
      },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);
    mockedCreateInternalApiToken.mockResolvedValue("internal-token");
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({ status: "approved" }),
    );

    const response = await POST(
      new Request("http://localhost:3200/api/auth/desktop?handoff=abc123", {
        method: "POST",
        headers: {
          origin: "http://localhost:3200",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Return to desktop");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/v1/auth/desktop-handoffs/abc123/approve",
      {
        method: "POST",
        headers: {
          authorization: "Bearer internal-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: "user-1",
          email: "solon@example.com",
          displayName: "Solon",
          avatarUrl: "https://cdn.discordapp.com/avatar.png",
        }),
        cache: "no-store",
      },
    );
  });

  it("logs API approval failures with status and response body", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockedGetServerAuthSession.mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);
    mockedCreateInternalApiToken.mockResolvedValue("internal-token");
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json(
        { message: "Invalid internal bearer token." },
        { status: 401 },
      ),
    );

    const response = await POST(
      new Request("http://localhost:3200/api/auth/desktop?handoff=abc123", {
        method: "POST",
        headers: {
          origin: "http://localhost:3200",
        },
      }),
    );

    expect(response.status).toBe(502);
    expect(consoleError).toHaveBeenCalledWith(
      "Desktop handoff approval failed.",
      expect.objectContaining({
        handoffId: "abc123",
        status: 401,
        statusText: "",
        body: '{"message":"Invalid internal bearer token."}',
        apiBaseUrl: "http://localhost:3001",
      }),
    );

    consoleError.mockRestore();
  });

  it("rejects cross-origin approval posts", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);

    const response = await POST(
      new Request("http://localhost:3200/api/auth/desktop?handoff=abc123", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain("Could not approve");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
