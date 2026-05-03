import { describe, expect, it, vi } from "vitest";
import { runSyncOnce, type SyncAdapters, type SyncState } from "./sync-engine";

function createBaseState(): SyncState {
  return {
    saveRoot: "C:/ShadowEmpire/Saves",
    token: "desktop-token",
    syncIntervalSeconds: 120,
    paused: false,
    campaigns: {},
  };
}

function createAdapters(overrides: Partial<SyncAdapters> = {}): SyncAdapters {
  return {
    now: () => new Date("2026-05-03T10:00:00.000Z"),
    decodeUserId: () => "user-1",
    listGames: vi.fn(async () => [
      {
        id: "game-1",
        slug: "ashes",
        gameNumber: 1,
        name: "Ashes",
        roundNumber: 4,
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
        participantUserIds: ["user-1", "user-2"],
      },
    ]),
    getGameDetail: vi.fn(async () => ({
      id: "game-1",
      gameNumber: 1,
      slug: "ashes",
      name: "Ashes",
      roundNumber: 4,
      activePlayerUserId: "user-1",
      activePlayerDisplayName: "Solon",
      fileVersions: [],
    })),
    ensureDir: vi.fn(async () => undefined),
    renameDir: vi.fn(async () => undefined),
    listLocalSaves: vi.fn(async () => [
      {
        name: "turn.se1",
        path: "C:/ShadowEmpire/Saves/1 - Ashes/turn.se1",
        modifiedAt: 2,
        size: 3,
        bytes: new Uint8Array([1, 2, 3]),
      },
    ]),
    uploadSave: vi.fn(async () => ({
      fileVersionId: "remote-1",
      originalName: "uploaded.se1",
    })),
    downloadFile: vi.fn(async () => ({
      bytes: new Uint8Array([9, 8, 7]),
      fileName: "remote.se1",
    })),
    writeFileAtomically: vi.fn(async () => "C:/ShadowEmpire/Saves/remote.se1"),
    listExistingFileNames: vi.fn(async () => []),
    ...overrides,
  };
}

describe("runSyncOnce", () => {
  it("uploads the newest pending save when it is the user turn", async () => {
    const state = createBaseState();
    const adapters = createAdapters();

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.uploadSave).toHaveBeenCalledWith(
      "desktop-token",
      1,
      expect.objectContaining({ name: "turn.se1" }),
    );
    expect(nextState.campaigns["game-1"]).toMatchObject({
      lastUploadedFileVersionId: "remote-1",
      status: "Uploaded turn.se1",
    });
  });

  it("downloads the newest remote save from another user when it is not the user turn", async () => {
    const state = createBaseState();
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "ashes",
        name: "Ashes",
        roundNumber: 4,
        activePlayerUserId: "user-2",
        activePlayerDisplayName: "Other",
        fileVersions: [
          {
            id: "remote-2",
            originalName: "remote.se1",
            uploadedAt: "2026-05-03T09:55:00.000Z",
            uploadedById: "user-2",
            uploadedByDisplayName: "Other",
          },
        ],
      })),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.downloadFile).toHaveBeenCalledWith(
      "desktop-token",
      1,
      "remote-2",
    );
    expect(nextState.campaigns["game-1"]).toMatchObject({
      lastDownloadedFileVersionId: "remote-2",
      status: "Downloaded remote.se1",
    });
  });

  it("does not download older remote saves after the newest remote save was already downloaded", async () => {
    const state: SyncState = {
      ...createBaseState(),
      campaigns: {
        "game-1": {
          lastDownloadedFileVersionId: "remote-newest",
        },
      },
    };
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "ashes",
        name: "Ashes",
        roundNumber: 4,
        activePlayerUserId: "user-2",
        activePlayerDisplayName: "Other",
        fileVersions: [
          {
            id: "remote-newest",
            originalName: "newest.se1",
            uploadedAt: "2026-05-03T09:55:00.000Z",
            uploadedById: "user-2",
            uploadedByDisplayName: "Other",
          },
          {
            id: "remote-older",
            originalName: "older.se1",
            uploadedAt: "2026-05-03T09:45:00.000Z",
            uploadedById: "user-2",
            uploadedByDisplayName: "Other",
          },
        ],
      })),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.downloadFile).not.toHaveBeenCalled();
    expect(nextState.campaigns["game-1"]).toMatchObject({
      lastDownloadedFileVersionId: "remote-newest",
      status: "No remote save to download",
    });
  });

  it("renames tracked campaign directories when API number or name changes", async () => {
    const state: SyncState = {
      ...createBaseState(),
      campaigns: {
        "game-1": {
          gameNumber: 1,
          name: "Old Ashes",
          directoryName: "G0001 - Old Ashes",
        },
      },
    };
    const adapters = createAdapters({
      listLocalSaves: vi.fn(async () => []),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.renameDir).toHaveBeenCalledWith(
      "C:/ShadowEmpire/Saves/G0001 - Old Ashes",
      "C:/ShadowEmpire/Saves/1 - Ashes",
    );
    expect(adapters.ensureDir).toHaveBeenCalledWith(
      "C:/ShadowEmpire/Saves/1 - Ashes",
    );
    expect(nextState.campaigns["game-1"]).toMatchObject({
      directoryName: "1 - Ashes",
    });
  });

  it("removes campaigns that are no longer assigned to the current user", async () => {
    const state: SyncState = {
      ...createBaseState(),
      campaigns: {
        "game-1": {
          gameNumber: 1,
          name: "Ashes",
          directoryName: "1 - Ashes",
          lastSyncedAt: "2026-05-03T09:00:00.000Z",
        },
        "game-2": {
          gameNumber: 2,
          name: "Cinders",
          directoryName: "2 - Cinders",
          lastSyncedAt: "2026-05-03T09:00:00.000Z",
        },
      },
    };
    const adapters = createAdapters({
      listGames: vi.fn(async () => [
        {
          id: "game-2",
          slug: "cinders",
          gameNumber: 2,
          name: "Cinders",
          roundNumber: 1,
          activePlayerUserId: "user-2",
          activePlayerDisplayName: "Other",
          participantUserIds: ["user-2"],
        },
      ]),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(nextState.campaigns).toEqual({});
    expect(nextState.lastStatus).toBe("Synced 0 campaign(s)");
  });

  it("keeps unauthenticated state visible without calling the API", async () => {
    const state = { ...createBaseState(), token: null };
    const adapters = createAdapters();

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.listGames).not.toHaveBeenCalled();
    expect(nextState.lastStatus).toBe("Sign in required");
  });

  it("records API failures for dashboard feedback", async () => {
    const adapters = createAdapters({
      listGames: vi.fn(async () => {
        throw new Error("API unavailable");
      }),
    });

    const nextState = await runSyncOnce(createBaseState(), adapters);

    expect(nextState.lastError).toBe("API unavailable");
  });

  it("does not sync when paused", async () => {
    const state = { ...createBaseState(), paused: true };
    const adapters = createAdapters();

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.listGames).not.toHaveBeenCalled();
    expect(nextState.lastStatus).toBe("Sync paused");
  });
});
