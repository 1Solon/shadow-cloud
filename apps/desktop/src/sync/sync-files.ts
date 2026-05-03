import type { CampaignSyncState } from "./sync-engine";

const windowsReservedNamePattern = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const unsafeFileNameCharactersPattern = /[<>:"/\\|?*\u0000-\u001f]/g;
const pathSeparatorPattern = /[\\/]/;

export type DirectoryEntry = {
  name: string;
  isFile: boolean;
};

export type LocalSaveFile = {
  name: string;
  path: string;
  modifiedAt: number;
  size: number;
  bytes: Uint8Array;
};

export function sanitizeDirectoryName(name: string) {
  const sanitized = name
    .replace(unsafeFileNameCharactersPattern, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  if (!sanitized || windowsReservedNamePattern.test(sanitized)) {
    return "Campaign";
  }

  return sanitized.slice(0, 96);
}

export function buildCampaignDirectoryName(gameNumber: number, name: string) {
  return `${gameNumber} - ${sanitizeDirectoryName(name)}`;
}

export function isShadowEmpireSave(entry: DirectoryEntry) {
  return entry.isFile && entry.name.toLowerCase().endsWith(".se1");
}

export async function createFileFingerprint(file: LocalSaveFile) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer,
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `${file.size}:${hash}`;
}

export async function chooseNewestPendingSave(
  files: LocalSaveFile[],
  uploadedFingerprints: Set<string>,
) {
  const newestFirst = [...files].sort((left, right) => {
    if (right.modifiedAt !== left.modifiedAt) {
      return right.modifiedAt - left.modifiedAt;
    }

    return right.name.localeCompare(left.name);
  });

  for (const file of newestFirst) {
    const fingerprint = await createFileFingerprint(file);

    if (!uploadedFingerprints.has(fingerprint)) {
      return {
        file,
        fingerprint,
      };
    }
  }

  return null;
}

export function getConflictSafeFileName(
  fileName: string,
  existingFileNames: Set<string>,
) {
  if (!existingFileNames.has(fileName)) {
    return fileName;
  }

  const extensionIndex = fileName.lastIndexOf(".");
  const baseName =
    extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";

  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${baseName} (${index})${extension}`;

    if (!existingFileNames.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not find a conflict-free name for ${fileName}.`);
}

export function getTrackedCampaignDirectoryNames(
  campaigns: Record<string, CampaignSyncState>,
) {
  const directoryNames = new Set<string>();

  for (const campaign of Object.values(campaigns)) {
    if (
      !campaign.directoryName ||
      pathSeparatorPattern.test(campaign.directoryName)
    ) {
      continue;
    }

    directoryNames.add(campaign.directoryName);
  }

  return [...directoryNames];
}
