import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/auth", () => ({
  getServerAuthSession: vi.fn(),
  createApiAccessToken: vi.fn(),
}));
vi.mock("@/lib/shadow-override", () => ({
  getShadowOverrideEnabled: vi.fn().mockResolvedValue(false),
}));
import { createApiAccessToken, getServerAuthSession } from "@/auth";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";
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
  expect(getShadowOverrideEnabled).not.toHaveBeenCalled();
  expect(createApiAccessToken).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it.each([true, false])(
  "uses the trusted override setting %s, not request headers",
  async (shadowOverrideEnabled) => {
    await authenticate();
    vi.mocked(getShadowOverrideEnabled).mockResolvedValue(
      shadowOverrideEnabled,
    );
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        fileVersionId: "file",
        contentRevision: 0,
        sourceId: "source",
        expectedSaveBaseline: "baseline",
        regimes: [],
      }),
    );
    const response = await GET(
      new Request("http://localhost/api/games/1/save-inspection", {
        headers: { shadowOverrideEnabled: String(!shadowOverrideEnabled) },
      }),
      { params: Promise.resolve({ gameNumber: "1" }) },
    );
    expect(response.status).toBe(200);
    expect(createApiAccessToken).toHaveBeenCalledWith(
      await getServerAuthSession(),
      { shadowOverrideEnabled },
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { authorization: expect.stringMatching(/^Bearer /) },
      }),
    );
  },
);
it("does not reach the API when token creation fails", async () => {
  await authenticate();
  vi.mocked(createApiAccessToken).mockRejectedValue(new Error("unavailable"));
  const fetch = vi.spyOn(globalThis, "fetch");
  expect((await request()).status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
});
it("preserves API authorization denials", async () => {
  await authenticate();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json(
      { message: "Only the current Overlord can inspect regimes." },
      { status: 403 },
    ),
  );
  const response = await request();
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Only the current Overlord can inspect regimes.",
  });
});
it("forwards authorization without caching and returns only allowlisted metadata", async () => {
  await authenticate();
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      fileVersionId: "file",
      contentRevision: 3,
      sourceId: "source",
      expectedSaveBaseline: "baseline",
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
    contentRevision: 3,
    sourceId: "source",
    expectedSaveBaseline: "baseline",
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
