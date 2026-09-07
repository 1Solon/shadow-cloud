import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/auth", () => ({
  getServerAuthSession: vi.fn(),
  createApiAccessToken: vi.fn(),
}));
import { createApiAccessToken, getServerAuthSession } from "@/auth";
import { GET } from "./route";
const request = () =>
  GET(new Request("http://localhost/api/games/1/save-inspection"), {
    params: Promise.resolve({ gameNumber: "1" }),
  });
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
async function authenticate() {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id: "actor" },
    expires: "2099-01-01",
  });
  vi.mocked(createApiAccessToken).mockResolvedValue(crypto.randomUUID());
}
it("requires a session before reaching the API", async () => {
  vi.mocked(getServerAuthSession).mockResolvedValue(null);
  const fetch = vi.spyOn(globalThis, "fetch");
  expect((await request()).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
it("forwards authorization without caching and returns only allowlisted metadata", async () => {
  await authenticate();
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      fileVersionId: "file",
      sourceId: "source",
      serializedObject: "excluded",
      regimes: [
        {
          id: "target",
          name: "North",
          current: true,
          eligible: true,
          reason: null,
          password: "excluded",
        },
      ],
    }),
  );
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    fileVersionId: "file",
    sourceId: "source",
    regimes: [
      {
        id: "target",
        name: "North",
        current: true,
        eligible: true,
        reason: null,
      },
    ],
  });
  expect(fetch).toHaveBeenCalledWith(
    "http://localhost:3001/v1/games/1/save-inspection",
    expect.objectContaining({
      cache: "no-store",
      headers: { authorization: expect.stringMatching(/^Bearer /) },
    }),
  );
});
it("does not relay unexpected server error contents", async () => {
  await authenticate();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ message: "untrusted error contents" }, { status: 500 }),
  );
  const response = await request();
  expect(await response.json()).toEqual({
    error: "Save inspection failed. Try again.",
  });
});
