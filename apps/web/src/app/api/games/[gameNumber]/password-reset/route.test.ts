import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/auth", () => ({
  getServerAuthSession: vi.fn(),
  createApiAccessToken: vi.fn(),
}));
import { getServerAuthSession, createApiAccessToken } from "@/auth";
import { POST, GET } from "./route";
import { POST as UNDO } from "./undo/route";
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
const body = {
  fileVersionId: "file",
  sourceId: "source",
  expectedSaveBaseline: "baseline",
  regimeId: "regime",
  password: "LocalSecret",
  confirmed: true,
};
const request = () =>
  POST(
    new Request("http://localhost/api/games/1/password-reset", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ gameNumber: "1" }) },
  );
it("requires a session before forwarding a secret", async () => {
  vi.mocked(getServerAuthSession).mockResolvedValue(null);
  const fetch = vi.spyOn(globalThis, "fetch");
  expect((await request()).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
it("uses authenticated request bodies and drops unexpected response/error fields", async () => {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id: "actor" },
    expires: "2099-01-01",
  });
  vi.mocked(createApiAccessToken).mockResolvedValue("token");
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      Response.json({ resetId: "reset", password: "excluded" }),
    )
    .mockResolvedValueOnce(
      Response.json({ message: body.password }, { status: 409 }),
    );
  const response = await request();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ resetId: "reset" });
  expect(fetch).toHaveBeenCalledWith(
    "http://localhost:3001/v1/games/1/password-reset",
    expect.objectContaining({
      body: JSON.stringify(body),
      headers: {
        authorization: "Bearer token",
        "Content-Type": "application/json",
      },
    }),
  );
  expect(await (await request()).text()).not.toContain(body.password);
});
it("allowlists recovery availability and binds undo to its specific output, never forwarding secret fields", async () => {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id: "actor" },
    expires: "2099-01-01",
  });
  vi.mocked(createApiAccessToken).mockResolvedValue("token");
  const undo = {
    resetId: "reset",
    outputId: "output",
    outputRevision: 1,
    expectedSaveBaseline: "baseline",
    regimeName: "North Reach",
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      Response.json({ undo: { ...undo, password: "excluded" } }),
    )
    .mockResolvedValueOnce(
      Response.json({ resetId: "reset", password: "excluded" }),
    );
  const context = { params: Promise.resolve({ gameNumber: "1" }) };
  const response = await GET(
    new Request("http://localhost/api/games/1/password-reset"),
    context,
  );
  expect(await response.json()).toEqual({ undo });
  expect(response.headers.get("cache-control")).toBe("no-store");
  const result = await UNDO(
    new Request("http://localhost/api/games/1/password-reset/undo", {
      method: "POST",
      body: JSON.stringify({ ...undo, confirmed: true, password: "excluded" }),
    }),
    context,
  );
  expect(await result.json()).toEqual({ resetId: "reset" });
  expect(fetch).toHaveBeenLastCalledWith(
    "http://localhost:3001/v1/games/1/password-reset/undo",
    expect.objectContaining({
      body: JSON.stringify({
        resetId: "reset",
        outputId: "output",
        outputRevision: 1,
        expectedSaveBaseline: "baseline",
        confirmed: true,
      }),
    }),
  );
});
it("denies unauthenticated undo and sanitizes undo failures", async () => {
  const request = () =>
    new Request("http://localhost/api/games/1/password-reset/undo", {
      method: "POST",
      body: JSON.stringify({ confirmed: true }),
    });
  const context = { params: Promise.resolve({ gameNumber: "1" }) };
  vi.mocked(getServerAuthSession).mockResolvedValue(null);
  expect((await UNDO(request(), context)).status).toBe(401);
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id: "actor" },
    expires: "2099-01-01",
  });
  vi.mocked(createApiAccessToken).mockResolvedValue("token");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ message: "private failure contents" }, { status: 503 }),
  );
  const response = await UNDO(request(), context);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private");
});
