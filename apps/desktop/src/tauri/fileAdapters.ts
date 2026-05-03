import { basename, join } from '@tauri-apps/api/path';
import {
  mkdir,
  readDir,
  readFile,
  rename,
  stat,
  writeFile,
} from '@tauri-apps/plugin-fs';
import type { SyncAdapters } from '@/sync/sync-engine';
import { isShadowEmpireSave, type LocalSaveFile } from '@/sync/sync-files';
import {
  downloadFile,
  getGameDetail,
  listGames,
  uploadSave,
} from '@/api/shadowCloudApi';
import { decodeDesktopTokenSubject } from '@/auth/desktopToken';

export const decodeTokenSubject = decodeDesktopTokenSubject;

async function listLocalSaves(campaignDirectoryPath: string) {
  const entries = await readDir(campaignDirectoryPath);
  const saves: LocalSaveFile[] = [];

  for (const entry of entries) {
    if (!isShadowEmpireSave({ name: entry.name, isFile: entry.isFile })) {
      continue;
    }

    const path = await join(campaignDirectoryPath, entry.name);
    const bytes = await readFile(path);
    const fileInfo = await stat(path);
    saves.push({
      name: entry.name,
      path,
      modifiedAt: fileInfo.mtime?.getTime() ?? Date.now(),
      size: bytes.byteLength,
      bytes,
    });
  }

  return saves;
}

async function listExistingFileNames(campaignDirectoryPath: string) {
  const entries = await readDir(campaignDirectoryPath);
  return entries.filter((entry) => entry.isFile).map((entry) => entry.name);
}

async function writeFileAtomically(
  campaignDirectoryPath: string,
  fileName: string,
  bytes: Uint8Array,
) {
  const temporaryPath = await join(
    campaignDirectoryPath,
    `.${fileName}.${Date.now()}.tmp`,
  );
  const finalPath = await join(campaignDirectoryPath, fileName);

  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, finalPath);

  return finalPath;
}

export function createTauriSyncAdapters(): SyncAdapters {
  return {
    now: () => new Date(),
    decodeUserId: decodeTokenSubject,
    listGames,
    getGameDetail,
    ensureDir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    renameDir: async (fromPath, toPath) => {
      await rename(fromPath, toPath);
    },
    listLocalSaves,
    uploadSave,
    downloadFile,
    listExistingFileNames,
    writeFileAtomically,
  };
}

export async function getPathBaseName(path: string) {
  return basename(path);
}
