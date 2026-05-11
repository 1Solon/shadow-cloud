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
      activePlayerEntryId: "entry-1",
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

    expect(adapters.uploadSave).toHaveBeenCalledWith("desktop-token", 1, {
      file: expect.objectContaining({ name: "turn.se1" }),
      contentHash: expect.stringMatching(/^sha256:/),
      idempotencyKey: expect.stringContaining("game-1:"),
      expectedActivePlayerEntryId: "entry-1",
      expectedActivePlayerUserId: "user-1",
      expectedRoundNumber: 4,
      expectedLatestFileVersionId: null,
    });
    expect(nextState.campaigns["game-1"]).toMatchObject({
      lastUploadedFileVersionId: "remote-1",
      status: "Uploaded turn.se1",
      ledger: [
        expect.objectContaining({
          direction: "upload",
          status: "completed",
          fileVersionId: "remote-1",
          contentHash: expect.stringMatching(/^sha256:/),
        }),
      ],
    });
  });

  it("does not upload stale local saves when a newer remote turn file exists", async () => {
    const state = createBaseState();
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "ashes",
        name: "Ashes",
        roundNumber: 4,
        activePlayerEntryId: "entry-1",
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
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
      listLocalSaves: vi.fn(async () => [
        {
          name: "stale-local.se1",
          path: "C:/ShadowEmpire/Saves/1 - Ashes/stale-local.se1",
          modifiedAt: new Date("2026-05-03T09:50:00.000Z").getTime(),
          size: 3,
          bytes: new Uint8Array([1, 2, 3]),
        },
      ]),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.uploadSave).not.toHaveBeenCalled();
    expect(nextState.campaigns["game-1"]).toMatchObject({
      status: "No pending .se1 saves",
    });
  });

  it("downloads the latest remote save when it is the user turn and the local folder has no saves", async () => {
    const state = createBaseState();
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "test1",
        name: "test1",
        roundNumber: 4,
        activePlayerEntryId: "entry-1",
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
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
      listLocalSaves: vi.fn(async () => []),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.uploadSave).not.toHaveBeenCalled();
    expect(adapters.downloadFile).toHaveBeenCalledWith(
      "desktop-token",
      1,
      "remote-2",
    );
    expect(adapters.writeFileAtomically).toHaveBeenCalledWith(
      "C:/ShadowEmpire/Saves/1 - test1",
      "remote.se1",
      new Uint8Array([9, 8, 7]),
    );
    expect(nextState.campaigns["game-1"]).toMatchObject({
      lastDownloadedFileVersionId: "remote-2",
      status: "Downloaded remote.se1",
    });
  });

  it("downloads the latest remote save uploaded by the current user when the local folder has no saves", async () => {
    const state = createBaseState();
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "test1",
        name: "test1",
        roundNumber: 4,
        activePlayerEntryId: "entry-1",
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
        fileVersions: [
          {
            id: "remote-2",
            originalName: "remote.se1",
            uploadedAt: "2026-05-03T09:55:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => []),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.uploadSave).not.toHaveBeenCalled();
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

  it("records the latest remote file turn as the load turn shown by desktop", async () => {
    const state = createBaseState();
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "test1",
        name: "test1",
        roundNumber: 11,
        activePlayerEntryId: "entry-1",
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
        fileVersions: [
          {
            id: "remote-10",
            originalName: "1-T10-S1-Solon.se1",
            uploadedAt: "2026-05-11T13:54:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
            contentHash:
              "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => []),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(nextState.campaigns["game-1"]).toMatchObject({
      roundNumber: 11,
      loadTurnNumber: 10,
      latestRemoteFileName: "1-T10-S1-Solon.se1",
    });
  });

  it("describes downloaded Shadow Cloud save filenames by load turn instead of save filename", async () => {
    const state = createBaseState();
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "test1",
        name: "test1",
        roundNumber: 11,
        activePlayerEntryId: "entry-1",
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
        fileVersions: [
          {
            id: "remote-11",
            originalName: "1-T11-S1-Solon.se1",
            uploadedAt: "2026-05-11T13:54:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => []),
      downloadFile: vi.fn(async () => ({
        bytes: new Uint8Array([9, 8, 7]),
        fileName: "1-T11-S1-Solon.se1",
      })),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(nextState.campaigns["game-1"]).toMatchObject({
      loadTurnNumber: 11,
      latestRemoteFileName: "1-T11-S1-Solon.se1",
      status: "Downloaded load turn 11",
    });
  });

  it("preserves the server filename when writing downloaded Shadow Cloud saves locally", async () => {
    const state = createBaseState();
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "test1",
        name: "test1",
        roundNumber: 11,
        activePlayerEntryId: "entry-1",
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
        fileVersions: [
          {
            id: "remote-11",
            originalName: "1-T11-S1-Solon.se1",
            uploadedAt: "2026-05-11T13:54:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => []),
      downloadFile: vi.fn(async () => ({
        bytes: new Uint8Array([9, 8, 7]),
        fileName: "1-T11-S1-Solon.se1",
      })),
    });

    await runSyncOnce(state, adapters);

    expect(adapters.writeFileAtomically).toHaveBeenCalledWith(
      "C:/ShadowEmpire/Saves/1 - test1",
      "1-T11-S1-Solon.se1",
      new Uint8Array([9, 8, 7]),
    );
  });

  it("uses the file-version name from game detail when the download header has the current turn name", async () => {
    const state = createBaseState();
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "test1",
        name: "test1",
        roundNumber: 11,
        activePlayerEntryId: "entry-1",
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
        fileVersions: [
          {
            id: "remote-10",
            originalName: "1-T10-S1-Solon.se1",
            uploadedAt: "2026-05-11T13:54:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => []),
      downloadFile: vi.fn(async () => ({
        bytes: new Uint8Array([9, 8, 7]),
        fileName: "1-T11-S1-Solon.se1",
      })),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.writeFileAtomically).toHaveBeenCalledWith(
      "C:/ShadowEmpire/Saves/1 - test1",
      "1-T10-S1-Solon.se1",
      new Uint8Array([9, 8, 7]),
    );
    expect(nextState.campaigns["game-1"]).toMatchObject({
      loadTurnNumber: 10,
      latestRemoteFileName: "1-T10-S1-Solon.se1",
      status: "Downloaded load turn 10",
    });
  });

  it("records downloaded file fingerprints so unchanged downloads are not re-uploaded", async () => {
    const state = createBaseState();
    const getGameDetail = vi.fn(async () => ({
      id: "game-1",
      gameNumber: 1,
      slug: "test1",
      name: "test1",
      roundNumber: 11,
      activePlayerEntryId: "entry-1",
      activePlayerUserId: "user-1",
      activePlayerDisplayName: "Solon",
      fileVersions: [
        {
          id: "remote-11",
          originalName: "1-T11-S1-Solon.se1",
          uploadedAt: "2026-05-11T13:54:00.000Z",
          uploadedById: "user-1",
          uploadedByDisplayName: "Solon",
          contentHash: null,
        },
      ],
    }));
    const downloadFile = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      fileName: "1-T11-S1-Solon.se1",
    }));

    const downloadedState = await runSyncOnce(
      state,
      createAdapters({
        getGameDetail,
        listLocalSaves: vi.fn(async () => []),
        downloadFile,
      }),
    );

    const nextState = await runSyncOnce(
      downloadedState,
      createAdapters({
        getGameDetail,
        listLocalSaves: vi.fn(async () => [
          {
            name: "1-T11-S1-Solon.se1",
            path: "C:/ShadowEmpire/Saves/1 - test1/1-T11-S1-Solon.se1",
            modifiedAt: new Date("2026-05-11T14:02:00.000Z").getTime(),
            size: 3,
            bytes: new Uint8Array([1, 2, 3]),
          },
        ]),
      }),
    );

    expect(nextState.campaigns["game-1"]).toMatchObject({
      uploadedFingerprints: [
        "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      ],
      status: "No pending .se1 saves",
    });
  });

  it("redownloads the canonical remote filename when a previous sync wrote the same bytes under the current turn name", async () => {
    const state: SyncState = {
      ...createBaseState(),
      campaigns: {
        "game-1": {
          lastDownloadedFileVersionId: "remote-10",
          uploadedFingerprints: [
            "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
          ],
        },
      },
    };
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "test1",
        name: "test1",
        roundNumber: 11,
        activePlayerEntryId: "entry-1",
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
        fileVersions: [
          {
            id: "remote-10",
            originalName: "1-T10-S1-Solon.se1",
            uploadedAt: "2026-05-11T13:54:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
            contentHash: null,
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => [
        {
          name: "1-T11-S1-Solon.se1",
          path: "C:/ShadowEmpire/Saves/1 - test1/1-T11-S1-Solon.se1",
          modifiedAt: new Date("2026-05-11T14:02:00.000Z").getTime(),
          size: 3,
          bytes: new Uint8Array([1, 2, 3]),
        },
      ]),
      downloadFile: vi.fn(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        fileName: "1-T11-S1-Solon.se1",
      })),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.uploadSave).not.toHaveBeenCalled();
    expect(adapters.writeFileAtomically).toHaveBeenCalledWith(
      "C:/ShadowEmpire/Saves/1 - test1",
      "1-T10-S1-Solon.se1",
      new Uint8Array([1, 2, 3]),
    );
    expect(nextState.campaigns["game-1"]).toMatchObject({
      lastDownloadedFileVersionId: "remote-10",
      status: "Downloaded load turn 10",
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
        activePlayerEntryId: "entry-2",
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

  it("downloads the latest remote save uploaded by the current user when it is not the user turn and the local folder has no saves", async () => {
    const state = createBaseState();
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "test1",
        name: "test1",
        roundNumber: 4,
        activePlayerEntryId: "entry-2",
        activePlayerUserId: "user-2",
        activePlayerDisplayName: "Other",
        fileVersions: [
          {
            id: "remote-2",
            originalName: "remote.se1",
            uploadedAt: "2026-05-03T09:55:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => []),
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
        activePlayerEntryId: "entry-2",
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

  it("keeps syncing other campaigns when one campaign fails", async () => {
    const state = createBaseState();
    const adapters = createAdapters({
      listGames: vi.fn(async () => [
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
        {
          id: "game-2",
          slug: "cinders",
          gameNumber: 2,
          name: "Cinders",
          roundNumber: 1,
          activePlayerUserId: "user-1",
          activePlayerDisplayName: "Solon",
          participantUserIds: ["user-1"],
        },
      ]),
      getGameDetail: vi.fn(async (_token, gameNumber) => {
        if (gameNumber === 1) {
          throw new Error("Campaign detail failed");
        }

        return {
          id: "game-2",
          gameNumber: 2,
          slug: "cinders",
          name: "Cinders",
          roundNumber: 1,
          activePlayerEntryId: "entry-2",
          activePlayerUserId: "user-1",
          activePlayerDisplayName: "Solon",
          fileVersions: [],
        };
      }),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.uploadSave).toHaveBeenCalledTimes(1);
    expect(nextState.campaigns["game-1"]).toMatchObject({
      gameNumber: 1,
      name: "Ashes",
      error: "Campaign detail failed",
      status: "Sync failed",
    });
    expect(nextState.campaigns["game-2"]).toMatchObject({
      status: "Uploaded turn.se1",
    });
    expect(nextState.lastStatus).toBe("Synced 1 campaign(s), 1 need attention");
    expect(nextState.lastError).toBe("1 campaign needs attention");
  });

  it("marks stale expected remote state as needing a user decision", async () => {
    const state: SyncState = {
      ...createBaseState(),
      campaigns: {
        "game-1": {
          lastDownloadedFileVersionId: "remote-old",
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
        activePlayerEntryId: "entry-1",
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
        fileVersions: [
          {
            id: "remote-new",
            originalName: "new.se1",
            uploadedAt: "2026-05-03T09:55:00.000Z",
            uploadedById: "user-2",
            uploadedByDisplayName: "Other",
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => [
        {
          name: "turn.se1",
          path: "C:/ShadowEmpire/Saves/1 - Ashes/turn.se1",
          modifiedAt: new Date("2026-05-03T10:00:00.000Z").getTime(),
          size: 3,
          bytes: new Uint8Array([1, 2, 3]),
        },
      ]),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.uploadSave).not.toHaveBeenCalled();
    expect(nextState.campaigns["game-1"]).toMatchObject({
      needsDecision: {
        reason: "remote-advanced-before-local-upload",
        localFileName: "turn.se1",
        remoteFileVersionId: "remote-new",
      },
      status: "Needs your decision",
    });
  });

  it("pauses upload when remote history predates sync safety metadata", async () => {
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "ashes",
        name: "Ashes",
        roundNumber: 4,
        activePlayerEntryId: "entry-1",
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
        fileVersions: [
          {
            id: "remote-old",
            originalName: "old.se1",
            uploadedAt: "2026-05-03T09:55:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
            contentHash: null,
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => [
        {
          name: "turn.se1",
          path: "C:/ShadowEmpire/Saves/1 - Ashes/turn.se1",
          modifiedAt: new Date("2026-05-03T10:00:00.000Z").getTime(),
          size: 3,
          bytes: new Uint8Array([1, 2, 3]),
        },
      ]),
    });

    const nextState = await runSyncOnce(createBaseState(), adapters);

    expect(adapters.uploadSave).not.toHaveBeenCalled();
    expect(nextState.campaigns["game-1"]).toMatchObject({
      needsDecision: {
        reason: "unverified-remote-history-before-local-upload",
        localFileName: "turn.se1",
        remoteFileVersionId: "remote-old",
      },
      status: "Needs your decision",
    });
  });

  it("pauses upload when a hashless remote file was previously downloaded but the local hash is unverified", async () => {
    const state: SyncState = {
      ...createBaseState(),
      campaigns: {
        "game-1": {
          lastDownloadedFileVersionId: "remote-old",
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
        activePlayerEntryId: "entry-1",
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
        fileVersions: [
          {
            id: "remote-old",
            originalName: "old.se1",
            uploadedAt: "2026-05-03T09:55:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
            contentHash: null,
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => [
        {
          name: "old.se1",
          path: "C:/ShadowEmpire/Saves/1 - Ashes/old.se1",
          modifiedAt: new Date("2026-05-03T10:00:00.000Z").getTime(),
          size: 3,
          bytes: new Uint8Array([1, 2, 3]),
        },
      ]),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.uploadSave).not.toHaveBeenCalled();
    expect(nextState.campaigns["game-1"]).toMatchObject({
      needsDecision: {
        reason: "unverified-remote-history-before-local-upload",
        localFileName: "old.se1",
        remoteFileVersionId: "remote-old",
      },
      status: "Needs your decision",
    });
  });

  it("does not upload when the local save hash already matches the latest remote save", async () => {
    const adapters = createAdapters({
      getGameDetail: vi.fn(async () => ({
        id: "game-1",
        gameNumber: 1,
        slug: "ashes",
        name: "Ashes",
        roundNumber: 4,
        activePlayerEntryId: "entry-1",
        activePlayerUserId: "user-1",
        activePlayerDisplayName: "Solon",
        fileVersions: [
          {
            id: "remote-current",
            originalName: "turn.se1",
            uploadedAt: "2026-05-03T09:55:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
            contentHash:
              "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => [
        {
          name: "turn.se1",
          path: "C:/ShadowEmpire/Saves/1 - Ashes/turn.se1",
          modifiedAt: new Date("2026-05-03T10:00:00.000Z").getTime(),
          size: 3,
          bytes: new Uint8Array([1, 2, 3]),
        },
      ]),
    });

    const nextState = await runSyncOnce(createBaseState(), adapters);

    expect(adapters.uploadSave).not.toHaveBeenCalled();
    expect(nextState.campaigns["game-1"]).toMatchObject({
      lastDownloadedFileVersionId: "remote-current",
      uploadedFingerprints: [
        "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      ],
      status: "Local save already matches latest remote",
    });
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
