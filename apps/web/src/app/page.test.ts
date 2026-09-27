import { expect, it, vi } from "vitest";
import type { GameListItem } from "@/lib/shadow-cloud-api";

const mocks = vi.hoisted(() => ({
  getServerAuthSession: vi.fn(),
  listGames: vi.fn(),
}));

vi.mock("@/auth", () => ({
  getServerAuthSession: mocks.getServerAuthSession,
}));
vi.mock("@/lib/shadow-cloud-api", () => ({
  listGames: mocks.listGames,
}));

const { generateMetadata } = await import("./page");

function gameWithActivePlayer(activePlayerUserId: string | null) {
  return { activePlayerUserId } as GameListItem;
}

it.each([
  [{ user: { id: "user-1" } }, "(2) Shadow-Cloud"],
  [{ user: { id: "user-3" } }, "Shadow-Cloud"],
  [null, "Shadow-Cloud"],
])(
  "counts campaigns awaiting the signed-in user in the title: %o",
  async (session, title) => {
    mocks.getServerAuthSession.mockResolvedValue(session);
    mocks.listGames.mockResolvedValue([
      gameWithActivePlayer("user-1"),
      gameWithActivePlayer("user-2"),
      gameWithActivePlayer("user-1"),
      gameWithActivePlayer(null),
    ]);

    await expect(generateMetadata()).resolves.toMatchObject({ title });
  },
);

it("keeps the plain title when campaigns cannot be loaded", async () => {
  mocks.getServerAuthSession.mockResolvedValue({ user: { id: "user-1" } });
  mocks.listGames.mockRejectedValue(new Error("API unavailable"));

  await expect(generateMetadata()).resolves.toMatchObject({
    title: "Shadow-Cloud",
  });
});
