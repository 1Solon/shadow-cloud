export type GameDetailFileVersionRecord = {
  id: string;
  originalName: string;
  uploadedAt: Date;
  uploadedById: string;
  contentHash: string | null;
  contentRevision: number;
  idempotencyKey: string | null;
  replacedAt: Date | null;
  uploadedBy: {
    displayName: string;
  };
  replacedBy: {
    displayName: string;
  } | null;
};

export type FileVersionPasswordResetRecord = {
  fileVersionId: string;
  outputRevision: number;
  reason: string | null;
  undoRevision: number | null;
  undoReason: string | null;
};

function replacementReason(
  fileVersion: GameDetailFileVersionRecord,
  passwordResets: FileVersionPasswordResetRecord[],
) {
  for (const reset of passwordResets) {
    if (reset.fileVersionId !== fileVersion.id) continue;
    if (reset.outputRevision === fileVersion.contentRevision)
      return reset.reason;
    if (reset.undoRevision === fileVersion.contentRevision)
      return reset.undoReason;
  }
  return null;
}

export function buildGameDetailFileVersionPayload(
  fileVersion: GameDetailFileVersionRecord,
  passwordResets: FileVersionPasswordResetRecord[],
) {
  return {
    id: fileVersion.id,
    originalName: fileVersion.originalName,
    uploadedAt: fileVersion.uploadedAt.toISOString(),
    uploadedById: fileVersion.uploadedById,
    uploadedByDisplayName: fileVersion.uploadedBy.displayName,
    contentHash: fileVersion.contentHash,
    contentRevision: fileVersion.contentRevision,
    idempotencyKey: fileVersion.idempotencyKey,
    replacedAt: fileVersion.replacedAt?.toISOString() ?? null,
    replacedByDisplayName: fileVersion.replacedBy?.displayName ?? null,
    replacementReason: replacementReason(fileVersion, passwordResets),
  };
}
