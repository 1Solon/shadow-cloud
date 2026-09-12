import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  createInternalApiToken: vi.fn(),
  getServerAuthSession: vi.fn(),
}));

import { createInternalApiToken, getServerAuthSession } from "@/auth";
import { GET, POST } from "./route";

const mockedCreateInternalApiToken = vi.mocked(createInternalApiToken);
const mockedGetServerAuthSession = vi.mocked(getServerAuthSession);

describe("/api/auth/companion", () => {
  beforeEach(() => {
    vi.stubEnv("SHADOW_CLOUD_API_URL", "http://localhost:3001");
    mockedCreateInternalApiToken.mockReset();
    mockedGetServerAuthSession.mockReset();
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  it("preserves the handoff while starting Discord sign in", async () => {
    mockedGetServerAuthSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost:3200/api/auth/companion?handoff=abc123"),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('action="/api/auth/signin/discord"');
    expect(body).toContain("/api/auth/companion?handoff=abc123");
    expect(body).toContain('name="csrfToken"');
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://discord.com",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("requires an explicit approval from an authenticated browser", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: { id: "user-1" },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);

    const response = await GET(
      new Request("http://localhost:3200/api/auth/companion?handoff=abc123"),
    );
    const body = await response.text();

    expect(body).toContain("APPROVE DEVICE SESSION");
    expect(body).toContain("cannot administer Campaigns or your account");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("approves a handoff and displays its one-use paste token", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: { id: "user-1" },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);
    mockedCreateInternalApiToken.mockResolvedValue("internal-token");
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({ status: "approved", pasteToken: "handoff.secret" }),
    );

    const response = await POST(
      new Request("http://localhost:3200/api/auth/companion?handoff=abc123", {
        method: "POST",
        headers: { origin: "http://localhost:3200" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await response.text();
    expect(body).toContain("Connected automatically");
    expect(body).toContain('value="handoff.secret"');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/v1/auth/companion-handoffs/abc123/approve",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each(["https://evil.example", "null", undefined])(
    "rejects approval posts with an untrusted or missing origin (%s)",
    async (origin) => {
      mockedGetServerAuthSession.mockResolvedValue({
        user: { id: "user-1" },
      } as Awaited<ReturnType<typeof getServerAuthSession>>);

      const response = await POST(
        new Request("http://localhost:3200/api/auth/companion?handoff=abc123", {
          method: "POST",
          headers: origin ? { origin } : {},
        }),
      );

      expect(response.status).toBe(403);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );
});
