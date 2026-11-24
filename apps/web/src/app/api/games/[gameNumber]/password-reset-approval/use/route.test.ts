import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/auth", () => ({
  getServerAuthSession: vi.fn(),
  createApiAccessToken: vi.fn(),
}));
vi.mock("@/lib/shadow-override", () => ({
  getShadowOverrideEnabled: vi.fn().mockResolvedValue(false),
}));
import { getServerAuthSession, createApiAccessToken } from "@/auth";
import { POST as USE } from "./route";

afterEach(() => {
  vi.restoreAllMocks();
});

const context = { params: Promise.resolve({ gameNumber: "1" }) };
const use = (body: unknown) =>
  USE(
    new Request("http://localhost/api/games/1/password-reset-approval/use", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    context,
  );

it("forwards only the approval, baseline and password, and returns a password-free receipt", async () => {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id: "player" },
    expires: "2099-01-01",
  });
  vi.mocked(createApiAccessToken).mockResolvedValue("token");
  const receipt = {
    resetId: "reset",
    fileVersionId: "file",
    contentRevision: 2,
    regimeName: "North Reach",
    replacedAt: "2026-09-08T10:00:00Z",
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ ...receipt, password: "excluded" }));
  const response = await use({
    approvalId: "approval",
    expectedSaveBaseline: "baseline",
    password: "PlayerSecret",
    confirmed: true,
    regimeId: "other",
  });
  expect(await response.json()).toEqual(receipt);
  expect(fetch).toHaveBeenCalledWith(
    "http://localhost:3001/v1/games/1/password-reset-approval/use",
    expect.objectContaining({
      body: JSON.stringify({
        approvalId: "approval",
        expectedSaveBaseline: "baseline",
        password: "PlayerSecret",
        confirmed: true,
      }),
    }),
  );
});

it("refuses an unconfirmed or unprintable password without reaching the API", async () => {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id: "player" },
    expires: "2099-01-01",
  });
  vi.mocked(createApiAccessToken).mockResolvedValue("token");
  const fetch = vi.spyOn(globalThis, "fetch");
  for (const body of [
    { approvalId: "approval", password: "PlayerSecret", confirmed: false },
    { approvalId: "approval", password: "bad\u0000", confirmed: true },
  ])
    expect((await use(body)).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
