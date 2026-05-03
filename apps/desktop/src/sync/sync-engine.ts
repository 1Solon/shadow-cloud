import {
  buildCampaignDirectoryName,
  chooseNewestPendingSave,
  getConflictSafeFileName,
  type LocalSaveFile,
} from './sync-files';

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
  activePlayerUserId: string | null;
  activePlayerDisplayName: string;
  fileVersions: Array<{
    id: string;
    originalName: string;
    uploadedAt: string;
    uploadedById: string;
    uploadedByDisplayName: string;
  }>;
};

export type CampaignSyncState = {
  gameNumber?: number;
  name?: string;
  roundNumber?: number;
  activePlayerUserId?: string | null;
  activePlayerDisplayName?: string;
  directoryName?: string;
  status?: string;
  error?: string;
  lastSyncedAt?: string;
  uploadedFingerprints?: string[];
  lastUploadedFileVersionId?: string;
  lastDownloadedFileVersionId?: string;
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
  listLocalSaves: (campaignDirectoryPath: string) => Promise<LocalSaveFile[]>;
  uploadSave: (
    token: string,
    gameNumber: number,
    file: LocalSaveFile,
  ) => Promise<{ fileVersionId: string; originalName: string }>;
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
};

function joinPath(left: string, right: string) {
  return `${left.replace(/[\\/]+$/g, '')}/${right}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Sync failed';
}

function getCampaignState(state: SyncState, gameId: string) {
  return state.campaigns[gameId] ?? {};
}

export async function runSyncOnce(
  state: SyncState,
  adapters: SyncAdapters,
): Promise<SyncState> {
  const timestamp = adapters.now().toISOString();

  if (state.paused) {
    return {
      ...state,
      lastStatus: 'Sync paused',
      lastError: undefined,
    };
  }

  if (!state.token) {
    return {
      ...state,
      lastStatus: 'Sign in required',
      lastError: undefined,
    };
  }

  if (!state.saveRoot) {
    return {
      ...state,
      lastStatus: 'Select a save root',
      lastError: undefined,
    };
  }

  const currentUserId = adapters.decodeUserId(state.token);

  if (!currentUserId) {
    return {
      ...state,
      lastStatus: 'Sign in required',
      lastError: 'Desktop token is missing a subject.',
    };
  }

  const nextState: SyncState = {
    ...state,
    lastStatus: undefined,
    lastError: undefined,
    campaigns: {
      ...state.campaigns,
    },
  };

  try {
    const games = await adapters.listGames(state.token);
    const participatingGames = games.filter((game) =>
      game.participantUserIds.includes(currentUserId),
    );

    for (const game of participatingGames) {
      const previousCampaignState = getCampaignState(nextState, game.id);
      const directoryName = buildCampaignDirectoryName(
        game.gameNumber,
        game.name,
      );
      const campaignDirectoryPath = joinPath(state.saveRoot, directoryName);

      await adapters.ensureDir(campaignDirectoryPath);

      const detail = await adapters.getGameDetail(state.token, game.gameNumber);
      const campaignState: CampaignSyncState = {
        ...previousCampaignState,
        gameNumber: detail.gameNumber,
        name: detail.name,
        roundNumber: detail.roundNumber,
        activePlayerUserId: detail.activePlayerUserId,
        activePlayerDisplayName: detail.activePlayerDisplayName,
        directoryName,
        error: undefined,
        lastSyncedAt: timestamp,
      };

      if (detail.activePlayerUserId === currentUserId) {
        const uploadedFingerprints = new Set(
          previousCampaignState.uploadedFingerprints ?? [],
        );
        const pendingSave = await chooseNewestPendingSave(
          await adapters.listLocalSaves(campaignDirectoryPath),
          uploadedFingerprints,
        );

        if (!pendingSave) {
          campaignState.status = 'No pending .se1 saves';
        } else {
          const upload = await adapters.uploadSave(
            state.token,
            game.gameNumber,
            pendingSave.file,
          );
          uploadedFingerprints.add(pendingSave.fingerprint);
          campaignState.uploadedFingerprints = [...uploadedFingerprints];
          campaignState.lastUploadedFileVersionId = upload.fileVersionId;
          campaignState.status = `Uploaded ${pendingSave.file.name}`;
        }
      } else {
        const remoteFile = detail.fileVersions.find(
          (fileVersion) =>
            fileVersion.uploadedById !== currentUserId &&
            fileVersion.id !== previousCampaignState.lastDownloadedFileVersionId,
        );

        if (!remoteFile) {
          campaignState.status = 'No remote save to download';
        } else {
          const download = await adapters.downloadFile(
            state.token,
            game.gameNumber,
            remoteFile.id,
          );
          const fileName = getConflictSafeFileName(
            download.fileName,
            new Set(await adapters.listExistingFileNames(campaignDirectoryPath)),
          );

          await adapters.writeFileAtomically(
            campaignDirectoryPath,
            fileName,
            download.bytes,
          );
          campaignState.lastDownloadedFileVersionId = remoteFile.id;
          campaignState.status = `Downloaded ${fileName}`;
        }
      }

      nextState.campaigns[game.id] = campaignState;
    }

    nextState.lastStatus = `Synced ${participatingGames.length} campaign(s)`;
    return nextState;
  } catch (error) {
    return {
      ...nextState,
      lastError: getErrorMessage(error),
    };
  }
}
