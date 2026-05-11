import { getErrorMessage } from "@/errors/error-message";
import {
  buildCampaignDirectoryName,
  chooseNewestPendingSave,
  createFileFingerprint,
  getConflictSafeFileName,
  parseSaveFileTurnNumber,
  type LocalSaveFile,
} from "./sync-files";

export type GameListItem = {
  id: string;
  slug: string;
  gameNumber: number;
  name: string;
  roundNumber: number;
  activePlayerUserId: string | null;
  activePlayerDisplayName: string;
  participantUserIds: string[];
};

export type GameDetail = {
  id: string;
  gameNumber: number;
  slug: string;
  name: string;
  roundNumber: number;
  activePlayerEntryId: string | null;
  activePlayerUserId: string | null;
  activePlayerDisplayName: string;
  fileVersions: Array<{
    id: string;
    originalName: string;
    uploadedAt: string;
    uploadedById: string;
    uploadedByDisplayName: string;
    contentHash?: string | null;
    idempotencyKey?: string | null;
  }>;
};

export type CampaignSyncState = {
  gameNumber?: number;
  name?: string;
  roundNumber?: number;
  loadTurnNumber?: number | null;
  latestRemoteFileName?: string;
  activePlayerUserId?: string | null;
  activePlayerDisplayName?: string;
  directoryName?: string;
  status?: string;
  error?: string;
  lastSyncedAt?: string;
  uploadedFingerprints?: string[];
  lastUploadedFileVersionId?: string;
  lastDownloadedFileVersionId?: string;
  needsDecision?: {
    reason:
      | "remote-advanced-before-local-upload"
      | "unverified-remote-history-before-local-upload"
      | "campaign-sync-failed";
    localFileName?: string;
    remoteFileVersionId?: string;
    message?: string;
  };
  ledger?: Array<{
    id: string;
    direction: "upload" | "download";
    status: "pending" | "completed" | "failed" | "needs-decision";
    contentHash?: string;
    fileName?: string;
    fileVersionId?: string;
    retryCount: number;
    lastError?: string;
    updatedAt: string;
  }>;
};

export type SyncState = {
  saveRoot: string | null;
  token: string | null;
  syncIntervalSeconds: number;
  paused: boolean;
  lastStatus?: string;
  lastError?: string;
  campaigns: Record<string, CampaignSyncState>;
};

export type SyncAdapters = {
  now: () => Date;
  decodeUserId: (token: string) => string | null;
  listGames: (token: string) => Promise<GameListItem[]>;
  getGameDetail: (token: string, gameNumber: number) => Promise<GameDetail>;
  ensureDir: (path: string) => Promise<void>;
  renameDir: (fromPath: string, toPath: string) => Promise<void>;
  listLocalSaves: (campaignDirectoryPath: string) => Promise<LocalSaveFile[]>;
  uploadSave: (
    token: string,
    gameNumber: number,
    upload: {
      file: LocalSaveFile;
      contentHash: string;
      idempotencyKey: string;
      expectedActivePlayerEntryId: string | null;
      expectedActivePlayerUserId: string | null;
      expectedRoundNumber: number;
      expectedLatestFileVersionId: string | null;
    },
  ) => Promise<{
    fileVersionId: string;
    originalName: string;
    idempotentReplay?: boolean;
  }>;
  downloadFile: (
    token: string,
    gameNumber: number,
    fileVersionId: string,
  ) => Promise<{ bytes: Uint8Array; fileName: string }>;
  listExistingFileNames: (campaignDirectoryPath: string) => Promise<string[]>;
  writeFileAtomically: (
    campaignDirectoryPath: string,
    fileName: string,
    bytes: Uint8Array,
  ) => Promise<string>;
  onStateUpdate?: (state: SyncState) => Promise<void>;
};

function joinPath(left: string, right: string) {
  return `${left.replace(/[\\/]+$/g, "")}/${right}`;
}

function getCampaignState(state: SyncState, gameId: string) {
  return state.campaigns[gameId] ?? {};
}

async function ensureCanonicalCampaignDirectory(
  saveRoot: string,
  previousDirectoryName: string | undefined,
  directoryName: string,
  adapters: SyncAdapters,
) {
  const campaignDirectoryPath = joinPath(saveRoot, directoryName);

  if (previousDirectoryName && previousDirectoryName !== directoryName) {
    await adapters.renameDir(
      joinPath(saveRoot, previousDirectoryName),
      campaignDirectoryPath,
    );
  }

  await adapters.ensureDir(campaignDirectoryPath);

  return campaignDirectoryPath;
}

function createLedgerId(input: {
  gameId: string;
  direction: "upload" | "download";
  contentHash?: string;
  fileVersionId?: string;
}) {
  return [
    input.gameId,
    input.direction,
    input.contentHash ?? input.fileVersionId ?? "unknown",
  ].join(":");
}

function addLedgerEntry(
  campaignState: CampaignSyncState,
  entry: NonNullable<CampaignSyncState["ledger"]>[number],
) {
  const existing = campaignState.ledger ?? [];
  campaignState.ledger = [
    ...existing.filter((candidate) => candidate.id !== entry.id),
    entry,
  ];
}

function getDownloadedStatus(fileName: string) {
  const turnNumber = parseSaveFileTurnNumber(fileName);

  if (turnNumber == null) {
    return `Downloaded ${fileName}`;
  }

  return `Downloaded load turn ${turnNumber}`;
}

async function persistProgress(
  nextState: SyncState,
  adapters: SyncAdapters,
) {
  await adapters.onStateUpdate?.(nextState);
}

async function downloadRemoteSave(input: {
  token: string;
  gameId: string;
  gameNumber: number;
  campaignDirectoryPath: string;
  campaignState: CampaignSyncState;
  remoteFile: GameDetail["fileVersions"][number];
  timestamp: string;
  adapters: SyncAdapters;
}) {
  const {
    token,
    gameId,
    gameNumber,
    campaignDirectoryPath,
    campaignState,
    remoteFile,
    timestamp,
    adapters,
  } = input;
  const download = await adapters.downloadFile(
    token,
    gameNumber,
    remoteFile.id,
  );
  const remoteFileName = remoteFile.originalName;
  const fileName = getConflictSafeFileName(
    remoteFileName,
    new Set(await adapters.listExistingFileNames(campaignDirectoryPath)),
  );

  await adapters.writeFileAtomically(
    campaignDirectoryPath,
    fileName,
    download.bytes,
  );
  const contentHash = await createFileFingerprint({
    name: fileName,
    path: joinPath(campaignDirectoryPath, fileName),
    modifiedAt: Date.parse(timestamp),
    size: download.bytes.byteLength,
    bytes: download.bytes,
  });
  const uploadedFingerprints = new Set(
    campaignState.uploadedFingerprints ?? [],
  );

  uploadedFingerprints.add(contentHash);
  campaignState.uploadedFingerprints = [...uploadedFingerprints];
  campaignState.lastDownloadedFileVersionId = remoteFile.id;
  campaignState.status = getDownloadedStatus(remoteFileName);
  addLedgerEntry(campaignState, {
    id: createLedgerId({
      gameId,
      direction: "download",
      fileVersionId: remoteFile.id,
    }),
    direction: "download",
    status: "completed",
    contentHash,
    fileName,
    fileVersionId: remoteFile.id,
    retryCount: 0,
    updatedAt: timestamp,
  });
}

async function syncCampaign(input: {
  state: SyncState;
  game: GameListItem;
  currentUserId: string;
  timestamp: string;
  adapters: SyncAdapters;
}) {
  const { state, game, currentUserId, timestamp, adapters } = input;
  const previousCampaignState = getCampaignState(state, game.id);
  const detail = await adapters.getGameDetail(state.token!, game.gameNumber);
  const latestRemoteFile = detail.fileVersions[0];
  const directoryName = buildCampaignDirectoryName(
    detail.gameNumber,
    detail.name,
  );
  let campaignDirectoryPath = joinPath(state.saveRoot!, directoryName);
  const campaignState: CampaignSyncState = {
    ...previousCampaignState,
    gameNumber: detail.gameNumber,
    name: detail.name,
    roundNumber: detail.roundNumber,
    loadTurnNumber: latestRemoteFile
      ? parseSaveFileTurnNumber(latestRemoteFile.originalName)
      : null,
    latestRemoteFileName: latestRemoteFile?.originalName,
    activePlayerUserId: detail.activePlayerUserId,
    activePlayerDisplayName: detail.activePlayerDisplayName,
    directoryName,
    error: undefined,
    needsDecision: undefined,
    lastSyncedAt: timestamp,
  };

  try {
    campaignDirectoryPath = await ensureCanonicalCampaignDirectory(
      state.saveRoot!,
      previousCampaignState.directoryName,
      directoryName,
      adapters,
    );
  } catch (error) {
    campaignState.error = getErrorMessage(error, "Could not rename campaign");
    await adapters.ensureDir(campaignDirectoryPath);
  }

  if (detail.activePlayerUserId === currentUserId) {
    const uploadedFingerprints = new Set(
      previousCampaignState.uploadedFingerprints ?? [],
    );
    const modifiedAfter =
      latestRemoteFile && latestRemoteFile.uploadedById !== currentUserId
        ? new Date(latestRemoteFile.uploadedAt).getTime()
        : undefined;
    const localSaves = await adapters.listLocalSaves(campaignDirectoryPath);
    const pendingSave = await chooseNewestPendingSave(
      localSaves,
      uploadedFingerprints,
      modifiedAfter,
    );

    if (!pendingSave) {
      const localSaveNames = new Set(localSaves.map((file) => file.name));

      if (
        localSaves.length === 0 &&
        latestRemoteFile &&
        previousCampaignState.lastDownloadedFileVersionId !==
          latestRemoteFile.id
      ) {
        await downloadRemoteSave({
          token: state.token!,
          gameId: game.id,
          gameNumber: detail.gameNumber,
          campaignDirectoryPath,
          campaignState,
          remoteFile: latestRemoteFile,
          timestamp,
          adapters,
        });
        return campaignState;
      }

      if (
        latestRemoteFile &&
        previousCampaignState.lastDownloadedFileVersionId ===
          latestRemoteFile.id &&
        !localSaveNames.has(latestRemoteFile.originalName)
      ) {
        await downloadRemoteSave({
          token: state.token!,
          gameId: game.id,
          gameNumber: detail.gameNumber,
          campaignDirectoryPath,
          campaignState,
          remoteFile: latestRemoteFile,
          timestamp,
          adapters,
        });
        return campaignState;
      }

      campaignState.status = "No pending .se1 saves";
      return campaignState;
    }

    if (
      latestRemoteFile &&
      latestRemoteFile.uploadedById !== currentUserId &&
      previousCampaignState.lastDownloadedFileVersionId !== latestRemoteFile.id
    ) {
      campaignState.status = "Needs your decision";
      campaignState.needsDecision = {
        reason: "remote-advanced-before-local-upload",
        localFileName: pendingSave.file.name,
        remoteFileVersionId: latestRemoteFile.id,
      };
      addLedgerEntry(campaignState, {
        id: createLedgerId({
          gameId: game.id,
          direction: "upload",
          contentHash: pendingSave.fingerprint,
        }),
        direction: "upload",
        status: "needs-decision",
        contentHash: pendingSave.fingerprint,
        fileName: pendingSave.file.name,
        fileVersionId: latestRemoteFile.id,
        retryCount: 0,
        updatedAt: timestamp,
      });
      return campaignState;
    }

    if (
      latestRemoteFile?.contentHash &&
      latestRemoteFile.contentHash === pendingSave.fingerprint
    ) {
      uploadedFingerprints.add(pendingSave.fingerprint);
      campaignState.uploadedFingerprints = [...uploadedFingerprints];
      campaignState.lastDownloadedFileVersionId = latestRemoteFile.id;
      campaignState.status = "Local save already matches latest remote";
      addLedgerEntry(campaignState, {
        id: createLedgerId({
          gameId: game.id,
          direction: "download",
          fileVersionId: latestRemoteFile.id,
        }),
        direction: "download",
        status: "completed",
        contentHash: pendingSave.fingerprint,
        fileName: pendingSave.file.name,
        fileVersionId: latestRemoteFile.id,
        retryCount: 0,
        updatedAt: timestamp,
      });
      return campaignState;
    }

    if (
      latestRemoteFile &&
      !latestRemoteFile.contentHash
    ) {
      campaignState.status = "Needs your decision";
      campaignState.needsDecision = {
        reason: "unverified-remote-history-before-local-upload",
        localFileName: pendingSave.file.name,
        remoteFileVersionId: latestRemoteFile.id,
      };
      addLedgerEntry(campaignState, {
        id: createLedgerId({
          gameId: game.id,
          direction: "upload",
          contentHash: pendingSave.fingerprint,
        }),
        direction: "upload",
        status: "needs-decision",
        contentHash: pendingSave.fingerprint,
        fileName: pendingSave.file.name,
        fileVersionId: latestRemoteFile.id,
        retryCount: 0,
        updatedAt: timestamp,
      });
      return campaignState;
    }

    const idempotencyKey = createLedgerId({
      gameId: game.id,
      direction: "upload",
      contentHash: pendingSave.fingerprint,
    });
    const upload = await adapters.uploadSave(state.token!, detail.gameNumber, {
      file: pendingSave.file,
      contentHash: pendingSave.fingerprint,
      idempotencyKey,
      expectedActivePlayerEntryId: detail.activePlayerEntryId,
      expectedActivePlayerUserId: detail.activePlayerUserId,
      expectedRoundNumber: detail.roundNumber,
      expectedLatestFileVersionId: latestRemoteFile?.id ?? null,
    });
    uploadedFingerprints.add(pendingSave.fingerprint);
    campaignState.uploadedFingerprints = [...uploadedFingerprints];
    campaignState.lastUploadedFileVersionId = upload.fileVersionId;
    campaignState.status = `Uploaded ${pendingSave.file.name}`;
    addLedgerEntry(campaignState, {
      id: idempotencyKey,
      direction: "upload",
      status: "completed",
      contentHash: pendingSave.fingerprint,
      fileName: pendingSave.file.name,
      fileVersionId: upload.fileVersionId,
      retryCount: 0,
      updatedAt: timestamp,
    });
    return campaignState;
  }

  const localSaves = await adapters.listLocalSaves(campaignDirectoryPath);
  const remoteFile =
    localSaves.length === 0
      ? detail.fileVersions[0]
      : detail.fileVersions.find(
          (fileVersion) => fileVersion.uploadedById !== currentUserId,
        );

  if (
    !remoteFile ||
    remoteFile.id === previousCampaignState.lastDownloadedFileVersionId
  ) {
    campaignState.status = "No remote save to download";
    return campaignState;
  }

  await downloadRemoteSave({
    token: state.token!,
    gameId: game.id,
    gameNumber: detail.gameNumber,
    campaignDirectoryPath,
    campaignState,
    remoteFile,
    timestamp,
    adapters,
  });
  return campaignState;
}

export async function runSyncOnce(
  state: SyncState,
  adapters: SyncAdapters,
): Promise<SyncState> {
  const timestamp = adapters.now().toISOString();

  if (state.paused) {
    return {
      ...state,
      lastStatus: "Sync paused",
      lastError: undefined,
    };
  }

  if (!state.token) {
    return {
      ...state,
      lastStatus: "Sign in required",
      lastError: undefined,
    };
  }

  if (!state.saveRoot) {
    return {
      ...state,
      lastStatus: "Select a save root",
      lastError: undefined,
    };
  }

  const currentUserId = adapters.decodeUserId(state.token);

  if (!currentUserId) {
    return {
      ...state,
      lastStatus: "Sign in required",
      lastError: "Desktop token is missing a subject.",
    };
  }

  const nextState: SyncState = {
    ...state,
    lastStatus: undefined,
    lastError: undefined,
    campaigns: state.campaigns,
  };

  try {
    const games = await adapters.listGames(state.token);
    const participatingGames = games.filter((game) =>
      game.participantUserIds.includes(currentUserId),
    );
    const nextCampaigns: Record<string, CampaignSyncState> = {};
    let completedCount = 0;
    let attentionCount = 0;

    for (const game of participatingGames) {
      try {
        const campaignState = await syncCampaign({
          state,
          game,
          currentUserId,
          timestamp,
          adapters,
        });
        nextCampaigns[game.id] = campaignState;

        if (campaignState.error || campaignState.needsDecision) {
          attentionCount += 1;
        } else {
          completedCount += 1;
        }
      } catch (error) {
        attentionCount += 1;
        nextCampaigns[game.id] = {
          ...getCampaignState(state, game.id),
          gameNumber: game.gameNumber,
          name: game.name,
          roundNumber: game.roundNumber,
          activePlayerUserId: game.activePlayerUserId,
          activePlayerDisplayName: game.activePlayerDisplayName,
          status: "Sync failed",
          error: getErrorMessage(error, "Sync failed"),
          needsDecision: {
            reason: "campaign-sync-failed",
            message: getErrorMessage(error, "Sync failed"),
          },
          lastSyncedAt: timestamp,
        };
      }

      nextState.campaigns = nextCampaigns;
      await persistProgress(nextState, adapters);
    }

    nextState.campaigns = nextCampaigns;
    nextState.lastStatus =
      attentionCount === 0
        ? `Synced ${completedCount} campaign(s)`
        : `Synced ${completedCount} campaign(s), ${attentionCount} need attention`;
    nextState.lastError =
      attentionCount === 0
        ? undefined
        : `${attentionCount} campaign${attentionCount === 1 ? "" : "s"} needs attention`;
    return nextState;
  } catch (error) {
    return {
      ...nextState,
      lastError: getErrorMessage(error, "Sync failed"),
    };
  }
}
