import { afterEach, describe, expect, it, vi } from "vitest";
import { createShadowCloudApiClient, listGames } from "./shadowCloudApi";

describe("Shadow-Cloud API client", () => {
  it("carries the save baseline and exposes conflicts without retrying", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        { message: "Refresh and review the latest save." },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const client = createShadowCloudApiClient();
    await expect(
      client.uploadSave("token", 1, {
        file: {
          name: "turn.se1",
          path: "turn.se1",
          modifiedAt: 1,
          size: 3,
          bytes: new Uint8Array([1, 2, 3]),
        },
        contentHash: "sha256:client",
        idempotencyKey: "upload-1",
        expectedActivePlayerEntryId: "seat",
        expectedActivePlayerUserId: "user",
        expectedRoundNumber: 1,
        expectedLatestFileVersionId: "version",
        expectedSaveBaseline: "campaign:1:2",
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Refresh and review the latest save.",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect((init.body as FormData).get("expectedSaveBaseline")).toBe(
      "campaign:1:2",
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the configured API base URL when the API cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(listGames("desktop-token")).rejects.toThrow(
      "Could not reach Shadow-Cloud API at https://shadow-cloud.solonsstuff.com.",
    );
  });

  it("uses a runtime API remote when one is supplied", async () => {
    const fetch = vi.fn(async () =>
      Response.json([
        {
          id: "game-1",
          slug: "ashes",
          gameNumber: 1,
          name: "Ashes",
          roundNumber: 4,
          activePlayerUserId: "user-1",
          activePlayerDisplayName: "Solon",
          participantUserIds: ["user-1"],
        },
      ]),
    );
    vi.stubGlobal("fetch", fetch);

    const client = createShadowCloudApiClient({
      apiBaseUrl: "https://api.example.test/",
    });

    await client.listGames("desktop-token");

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/v1/games",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer desktop-token",
        }),
      }),
    );
  });
});
