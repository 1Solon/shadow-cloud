import { describe, expect, it, vi } from "vitest";
import {
  runSyncOnce,
  type GameDetail,
  type SyncAdapters,
  type SyncState,
} from "./sync-engine";
import type { LocalSaveFile } from "./sync-files";

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
      saveBaseline: "campaign:2:3",
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
  it.each(["network", "write", "revision-race"])(
    "recovers a replacement download after %s failure without accepting an unreceived revision",
    async (failure) => {
      const state = createBaseState();
      state.campaigns["game-1"] = {
        lastDownloadedFileVersionId: "same-id",
        lastDownloadedContentRevision: 0,
      };
      const adapters = createAdapters({ listLocalSaves: async () => [] });
      const detail: GameDetail = {
        ...(await adapters.getGameDetail("desktop-token", 1)),
        fileVersions: [
          {
            id: "same-id",
            originalName: "1-T4-S1-Solon.se1",
            uploadedAt: "2026-09-07T10:00:00Z",
            uploadedById: "user-2",
            uploadedByDisplayName: "Other",
            contentRevision: 1,
            contentHash:
              "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
          },
        ],
      };
      adapters.getGameDetail = async () => detail;
      adapters.downloadFile = vi.fn(async () => {
        if (failure === "network") throw new Error("Download unavailable");
        return {
          bytes: new Uint8Array(
            failure === "revision-race" ? [9, 8, 7] : [1, 2, 3],
          ),
          fileName: "ignored.se1",
        };
      });
      if (failure === "write")
        adapters.writeFileAtomically = vi.fn(async () => {
          throw new Error("Disk full");
        });
      const failed = await runSyncOnce(state, adapters);
      expect(failed.campaigns["game-1"]).toMatchObject({
        status: "Sync failed",
        lastDownloadedContentRevision: 0,
      });
      expect(failed.campaigns["game-1"].uploadedFingerprints).toBeUndefined();
      if (failure !== "write")
        expect(adapters.writeFileAtomically).not.toHaveBeenCalled();
      detail.fileVersions[0].contentRevision = 3;
      adapters.downloadFile = vi.fn(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        fileName: "ignored.se1",
      }));
      adapters.writeFileAtomically = vi.fn(async () => "saved");
      const recovered = await runSyncOnce(failed, adapters);
      expect(recovered.campaigns["game-1"]).toMatchObject({
        status: "Downloaded load turn 4",
        lastDownloadedContentRevision: 3,
      });
      expect(recovered.campaigns["game-1"].error).toBeUndefined();
      expect(recovered.campaigns["game-1"].needsDecision).toBeUndefined();
      expect(adapters.writeFileAtomically).toHaveBeenCalledWith(
        "C:/ShadowEmpire/Saves/1 - Ashes",
        "1-T4-S1-Solon.se1",
        new Uint8Array([1, 2, 3]),
      );
      expect(adapters.uploadSave).not.toHaveBeenCalled();
    },
  );

  it.each(["user-1", "user-2"])(
    "protects pending local work after an original uploader's reset while %s is active",
    async (activePlayerUserId) => {
      const adapters = createAdapters();
      const localFiles = await adapters.listLocalSaves("unused");
      const detail: GameDetail = {
        ...(await adapters.getGameDetail("desktop-token", 1)),
        activePlayerUserId,
        fileVersions: [
          {
            id: "remote-1",
            originalName: "1-T4-S1-Solon.se1",
            uploadedAt: "2026-09-07T10:00:00Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
            contentRevision: 1,
          },
        ],
      };
      adapters.getGameDetail = async () => detail;
      adapters.listLocalSaves = async () => localFiles;
      const state = createBaseState();
      state.campaigns["game-1"] = { lastUploadedFileVersionId: "remote-1" };
      let next = await runSyncOnce(state, adapters);
      const message =
        "The latest save changed. Your local files have been preserved. Pause sync and move unfinished saves outside the campaign folder, then sync again to obtain the updated save, or open the campaign page and download it. Stop and restart the current turn from the updated save. Uploading a turn played from the old copy could undo this password reset.";
      expect(next.campaigns["game-1"]).toMatchObject({
        status: "Needs your decision",
        error: message,
        needsDecision: { message, localFileName: "turn.se1" },
      });
      detail.fileVersions[0].contentRevision = 2;
      next = await runSyncOnce(next, adapters);
      expect(next.campaigns["game-1"].needsDecision?.message).toBe(message);
      expect(adapters.uploadSave).not.toHaveBeenCalled();
      expect(adapters.writeFileAtomically).not.toHaveBeenCalled();
      expect(localFiles[0].bytes).toEqual(new Uint8Array([1, 2, 3]));
      adapters.listLocalSaves = async () => [];
      next = await runSyncOnce(next, adapters);
      expect(next.campaigns["game-1"]).toMatchObject({
        lastDownloadedContentRevision: 2,
        status: "Downloaded load turn 4",
      });
      expect(next.campaigns["game-1"].needsDecision).toBeUndefined();
      expect(next.campaigns["game-1"].error).toBeUndefined();
    },
  );

  it.each(["replacement", "advanced-remote", "unverified-history"])(
    "never uploads unchanged work rejected by %s preflight after it is moved out and returned",
    async (conflict) => {
      const a: LocalSaveFile = {
        name: "unfinished.se1",
        path: "unfinished.se1",
        modifiedAt: Date.parse("2026-09-07T12:00:00Z"),
        size: 3,
        bytes: new Uint8Array([4, 5, 6]),
      };
      let files = [a];
      const adapters = createAdapters({
        listLocalSaves: async () => files,
        listExistingFileNames: async () => files.map((file) => file.name),
        downloadFile: vi.fn(async () => ({
          bytes: new Uint8Array([1, 2, 3]),
          fileName: "updated.se1",
        })),
        writeFileAtomically: vi.fn(async (directory, name, bytes) => {
          const path = `${directory}/${name}`;
          files.push({ name, path, bytes, size: bytes.length, modifiedAt: 1 });
          return path;
        }),
      });
      const detail: GameDetail = {
        ...(await adapters.getGameDetail("desktop-token", 1)),
        fileVersions: [
          {
            id: "remote-1",
            originalName: "updated.se1",
            uploadedAt: "2026-09-07T10:00:00Z",
            uploadedById: conflict === "advanced-remote" ? "user-2" : "user-1",
            uploadedByDisplayName: "Solon",
            contentRevision: conflict === "replacement" ? 1 : 0,
            contentHash:
              conflict === "unverified-history"
                ? null
                : "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
          },
        ],
      };
      adapters.getGameDetail = async () => detail;
      let state = await runSyncOnce(createBaseState(), adapters);
      expect(state.campaigns["game-1"].needsDecision).toMatchObject({
        reason:
          conflict === "unverified-history"
            ? "unverified-remote-history-before-local-upload"
            : "remote-advanced-before-local-upload",
        localFileName: a.name,
      });
      expect(adapters.uploadSave).not.toHaveBeenCalled();
      expect(adapters.writeFileAtomically).not.toHaveBeenCalled();

      files = [];
      state = await runSyncOnce(state, adapters);
      expect(adapters.writeFileAtomically).toHaveBeenCalledTimes(1);
      expect(state.campaigns["game-1"].needsDecision).toBeUndefined();
      detail.saveBaseline = "fresh-baseline";
      detail.fileVersions[0].contentHash =
        "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
      files.push({
        ...a,
        name: "returned.se1",
        path: "returned.se1",
        modifiedAt: a.modifiedAt + 1,
      });
      state = await runSyncOnce(JSON.parse(JSON.stringify(state)), adapters);
      state = await runSyncOnce(state, adapters);
      expect(adapters.uploadSave).not.toHaveBeenCalled();
      expect(state.campaigns["game-1"].needsDecision?.localFileName).toBe(
        "returned.se1",
      );
      expect(files.at(-1)?.bytes).toEqual(new Uint8Array([4, 5, 6]));
    },
  );

  it.each(["user-1", "user-2"])(
    "downloads reset and undo revisions with the same ID and timestamp while %s is active, preserving old copies",
    async (activePlayerUserId) => {
      const files: LocalSaveFile[] = [];
      const adapters = createAdapters({
        listLocalSaves: async () => files,
        listExistingFileNames: async () => files.map((file) => file.name),
        writeFileAtomically: async (directory, name, bytes) => {
          expect(files.some((file) => file.name === name)).toBe(false);
          const path = `${directory}/${name}`;
          files.push({
            name,
            path,
            bytes,
            size: bytes.length,
            modifiedAt: Date.parse("2026-09-07T12:00:00Z"),
          });
          return path;
        },
      });
      const detail: GameDetail = {
        ...(await adapters.getGameDetail("desktop-token", 1)),
        activePlayerUserId,
        fileVersions: [
          {
            id: "same-id",
            originalName: "1-T4-S1-Solon.se1",
            uploadedAt: "2026-09-07T10:00:00Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
            contentRevision: 0,
          },
        ],
      };
      adapters.getGameDetail = async () => detail;
      let state = await runSyncOnce(createBaseState(), adapters);
      for (const revision of [1, 2, 5]) {
        detail.fileVersions[0].contentRevision = revision;
        detail.fileVersions[0].replacedAt = "2026-09-07T11:00:00Z";
        adapters.downloadFile = vi.fn(async () => ({
          bytes: new Uint8Array(revision === 2 ? [9, 8, 7] : [revision]),
          fileName: "ignored.se1",
        }));
        state = await runSyncOnce(state, adapters);
        expect(state.campaigns["game-1"].lastDownloadedContentRevision).toBe(
          revision,
        );
        expect(state.campaigns["game-1"].status).toContain(
          "Use this updated save before continuing.",
        );
        expect(state.campaigns["game-1"].status).toContain(files.at(-1)?.name);
        state = await runSyncOnce(state, adapters);
        expect(adapters.downloadFile).toHaveBeenCalledTimes(1);
      }
      expect(files.map((file) => file.name)).toEqual([
        "1-T4-S1-Solon.se1",
        "1-T4-S1-Solon (1).se1",
        "1-T4-S1-Solon (2).se1",
        "1-T4-S1-Solon (3).se1",
      ]);
      expect(files.map((file) => [...file.bytes])).toEqual([
        [9, 8, 7],
        [1],
        [9, 8, 7],
        [5],
      ]);
      expect(adapters.uploadSave).not.toHaveBeenCalled();
    },
  );

  it("obtains a reset of an own upload that was never downloaded, then uploads new work with the current baseline", async () => {
    const adapters = createAdapters({
      downloadFile: async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        fileName: "remote.se1",
      }),
    });
    const state = createBaseState();
    state.campaigns["game-1"] = {
      lastUploadedFileVersionId: "remote-1",
      lastDownloadedFileVersionId: "older-turn",
      uploadedFingerprints: [
        "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      ],
    };
    const detail: GameDetail = {
      ...(await adapters.getGameDetail("desktop-token", 1)),
      saveBaseline: "after-reset",
      fileVersions: [
        {
          id: "remote-1",
          originalName: "turn.se1",
          uploadedAt: "2026-09-07T10:00:00Z",
          uploadedById: "user-1",
          uploadedByDisplayName: "Solon",
          contentRevision: 1,
          contentHash:
            "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
        },
      ],
    };
    adapters.getGameDetail = async () => detail;
    const downloaded = await runSyncOnce(state, adapters);
    expect(downloaded.campaigns["game-1"].lastDownloadedContentRevision).toBe(
      1,
    );
    expect(adapters.uploadSave).not.toHaveBeenCalled();
    adapters.listLocalSaves = async () => [
      {
        name: "replayed-turn.se1",
        path: "replayed-turn.se1",
        bytes: new Uint8Array([4, 5, 6]),
        size: 3,
        modifiedAt: Date.parse("2026-09-07T12:00:00Z"),
      },
    ];
    const uploaded = await runSyncOnce(downloaded, adapters);
    expect(uploaded.campaigns["game-1"].status).toBe(
      "Uploaded replayed-turn.se1",
    );
    expect(adapters.uploadSave).toHaveBeenCalledWith(
      "desktop-token",
      1,
      expect.objectContaining({
        expectedSaveBaseline: "after-reset",
        expectedLatestFileVersionId: "remote-1",
        file: expect.objectContaining({ bytes: new Uint8Array([4, 5, 6]) }),
      }),
    );
  });

  it("does not retry conflicted local bytes on the next poll with a refreshed baseline", async () => {
    const adapters = createAdapters({
      uploadSave: vi.fn(async () => {
        throw Object.assign(
          new Error("The save changed. Review the latest save."),
          { status: 409 },
        );
      }),
    });
    const first = await runSyncOnce(createBaseState(), adapters);
    expect(first.campaigns["game-1"].error).toContain(
      "Uploading a turn played from the old copy could undo this password reset.",
    );
    const detail = await adapters.getGameDetail("desktop-token", 1);
    adapters.getGameDetail = vi.fn(async () => ({
      ...detail,
      saveBaseline: "campaign:2:4",
    }));
    const second = await runSyncOnce(first, adapters);
    expect(second.campaigns["game-1"].error).toBe(
      first.campaigns["game-1"].error,
    );
    expect(adapters.uploadSave).toHaveBeenCalledTimes(1);
    expect(second.campaigns["game-1"].needsDecision?.message).toMatch(
      /save changed/i,
    );
  });
  it.each(["conflicts", "succeeds"])(
    "never retries rejected A after newer B %s and is removed",
    async (outcome) => {
      const adapters = createAdapters();
      const [a] = await adapters.listLocalSaves("unused");
      const b = {
        ...a,
        name: "b.se1",
        modifiedAt: 3,
        bytes: new Uint8Array([4, 5, 6]),
      };
      const conflict = Object.assign(new Error("Inspect the changed save."), {
        status: 409,
      });
      const upload = vi
        .fn<SyncAdapters["uploadSave"]>()
        .mockRejectedValueOnce(conflict);
      if (outcome === "conflicts") upload.mockRejectedValueOnce(conflict);
      else
        upload.mockResolvedValueOnce({
          fileVersionId: "b",
          originalName: b.name,
        });
      upload.mockResolvedValue({
        fileVersionId: "unexpected",
        originalName: a.name,
      });
      adapters.uploadSave = upload;
      let state = await runSyncOnce(createBaseState(), adapters);
      adapters.listLocalSaves = async () => [a, b];
      state = await runSyncOnce(state, adapters);
      expect(upload).toHaveBeenCalledTimes(2);
      const detail = await adapters.getGameDetail("desktop-token", 1);
      adapters.getGameDetail = async () => ({
        ...detail,
        saveBaseline: "fresh-baseline",
      });
      adapters.listLocalSaves = async () => [a];
      // Poll from serialized state, as after a desktop restart.
      state = await runSyncOnce(JSON.parse(JSON.stringify(state)), adapters);
      state = await runSyncOnce(state, adapters);
      expect(upload).toHaveBeenCalledTimes(2);
      expect(state.campaigns["game-1"].needsDecision?.localFileName).toBe(
        a.name,
      );
      if (outcome === "conflicts") {
        adapters.listLocalSaves = async () => [b];
        state = await runSyncOnce(state, adapters);
        expect(upload).toHaveBeenCalledTimes(2);
        expect(state.campaigns["game-1"].needsDecision?.localFileName).toBe(
          b.name,
        );
      }
    },
  );

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
      expectedSaveBaseline: "campaign:2:3",
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
      downloadFile: async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        fileName: "1-T10-S1-Solon.se1",
      }),
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

  it("redownloads a corrected remote save once when it is not the user turn", async () => {
    const state: SyncState = {
      ...createBaseState(),
      campaigns: {
        "game-1": {
          uploadedFingerprints: [
            "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
          ],
          lastDownloadedFileVersionId: "version-7",
          lastDownloadedFileReplacedAt: "2026-07-10T14:30:00.000Z",
          lastDownloadedContentRevision: 1,
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
            id: "version-7",
            originalName: "42-T4-S2-Other.se1",
            uploadedAt: "2026-07-10T14:00:00.000Z",
            uploadedById: "owner-1",
            uploadedByDisplayName: "Other",
            contentHash: null,
            idempotencyKey: null,
            replacedAt: "2026-07-10T14:30:00.000Z",
            contentRevision: 2,
            replacedByDisplayName: "Other",
          },
        ],
      })),
    });

    const downloadedState = await runSyncOnce(state, adapters);
    const nextState = await runSyncOnce(downloadedState, adapters);

    expect(adapters.downloadFile).toHaveBeenCalledTimes(1);
    expect(nextState.campaigns["game-1"]).toMatchObject({
      lastDownloadedFileVersionId: "version-7",
      lastDownloadedFileReplacedAt: "2026-07-10T14:30:00.000Z",
      lastDownloadedContentRevision: 2,
    });
  });

  it("downloads a corrected remote save when the active player has no local saves", async () => {
    const state: SyncState = {
      ...createBaseState(),
      campaigns: {
        "game-1": {
          lastDownloadedFileVersionId: "version-7",
          lastDownloadedFileReplacedAt: null,
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
            id: "version-7",
            originalName: "42-T4-S2-Other.se1",
            uploadedAt: "2026-07-10T14:00:00.000Z",
            uploadedById: "owner-1",
            uploadedByDisplayName: "Other",
            replacedAt: "2026-07-10T14:30:00.000Z",
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => []),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.downloadFile).toHaveBeenCalledTimes(1);
    expect(nextState.campaigns["game-1"]).toMatchObject({
      lastDownloadedFileVersionId: "version-7",
      lastDownloadedFileReplacedAt: "2026-07-10T14:30:00.000Z",
    });
  });

  it("requires a decision before uploading a local save when the remote revision changed", async () => {
    const state: SyncState = {
      ...createBaseState(),
      campaigns: {
        "game-1": {
          lastDownloadedFileVersionId: "version-7",
          lastDownloadedFileReplacedAt: null,
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
            id: "version-7",
            originalName: "42-T4-S2-Other.se1",
            uploadedAt: "2026-07-10T14:00:00.000Z",
            uploadedById: "owner-1",
            uploadedByDisplayName: "Other",
            contentHash: "sha256:remote-content",
            replacedAt: "2026-07-10T14:30:00.000Z",
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => [
        {
          name: "turn.se1",
          path: "C:/ShadowEmpire/Saves/1 - Ashes/turn.se1",
          modifiedAt: new Date("2026-07-10T14:45:00.000Z").getTime(),
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
        remoteFileVersionId: "version-7",
      },
      status: "Needs your decision",
    });
  });

  it("requires a decision before uploading a local save when an own remote revision changed", async () => {
    const state: SyncState = {
      ...createBaseState(),
      campaigns: {
        "game-1": {
          lastDownloadedFileVersionId: "version-7",
          lastDownloadedFileReplacedAt: null,
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
            id: "version-7",
            originalName: "42-T4-S2-Solon.se1",
            uploadedAt: "2026-07-10T14:00:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
            contentHash: "sha256:remote-content",
            replacedAt: "2026-07-10T14:30:00.000Z",
          },
        ],
      })),
      listLocalSaves: vi.fn(async () => [
        {
          name: "turn.se1",
          path: "C:/ShadowEmpire/Saves/1 - Ashes/turn.se1",
          modifiedAt: new Date("2026-07-10T14:45:00.000Z").getTime(),
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
        remoteFileVersionId: "version-7",
      },
      status: "Needs your decision",
    });
  });

  it("downloads a corrected own remote save when it is not the user turn and local saves exist", async () => {
    const state: SyncState = {
      ...createBaseState(),
      campaigns: {
        "game-1": {
          uploadedFingerprints: [
            "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
          ],
          lastDownloadedFileVersionId: "version-7",
          lastDownloadedFileReplacedAt: null,
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
            id: "version-7",
            originalName: "42-T4-S2-Solon.se1",
            uploadedAt: "2026-07-10T14:00:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
            replacedAt: "2026-07-10T14:30:00.000Z",
          },
        ],
      })),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.downloadFile).toHaveBeenCalledWith(
      "desktop-token",
      1,
      "version-7",
    );
    expect(nextState.campaigns["game-1"]).toMatchObject({
      lastDownloadedFileVersionId: "version-7",
      lastDownloadedFileReplacedAt: "2026-07-10T14:30:00.000Z",
    });
  });

  it("does not download an unchanged own upload when it is not the user turn", async () => {
    const state: SyncState = {
      ...createBaseState(),
      campaigns: {
        "game-1": {
          lastDownloadedFileVersionId: "version-6",
          lastDownloadedFileReplacedAt: null,
          lastUploadedFileVersionId: "version-7",
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
            id: "version-7",
            originalName: "42-T4-S2-Solon.se1",
            uploadedAt: "2026-07-10T14:00:00.000Z",
            uploadedById: "user-1",
            uploadedByDisplayName: "Solon",
          },
        ],
      })),
    });

    const nextState = await runSyncOnce(state, adapters);

    expect(adapters.downloadFile).not.toHaveBeenCalled();
    expect(nextState.campaigns["game-1"].status).toBe(
      "No remote save to download",
    );
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
