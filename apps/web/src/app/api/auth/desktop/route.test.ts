import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  getServerAuthSession: vi.fn(),
  createDesktopApiAccessToken: vi.fn(),
}));

import { createDesktopApiAccessToken, getServerAuthSession } from "@/auth";
import { GET } from "./route";

const mockedGetServerAuthSession = vi.mocked(getServerAuthSession);
const mockedCreateDesktopApiAccessToken = vi.mocked(
  createDesktopApiAccessToken,
);

describe("GET /api/auth/desktop", () => {
  beforeEach(() => {
    mockedGetServerAuthSession.mockReset();
    mockedCreateDesktopApiAccessToken.mockReset();
  });

  it("shows instructions when opened directly in a browser", async () => {
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
    expect(mockedCreateDesktopApiAccessToken).not.toHaveBeenCalled();
  });

  it("redirects to the desktop protocol for app-initiated handoff", async () => {
    mockedGetServerAuthSession.mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as Awaited<ReturnType<typeof getServerAuthSession>>);
    mockedCreateDesktopApiAccessToken.mockResolvedValue("desktop-token");

    const response = await GET(
      new Request("http://localhost:3200/api/auth/desktop?handoff=1"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "shadow-cloud://auth?token=desktop-token",
    );
  });
});
