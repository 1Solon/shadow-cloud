export type GameDetailFileVersionRecord = {
  id: string;
  originalName: string;
  uploadedAt: Date;
  uploadedById: string;
  contentHash: string | null;
  idempotencyKey: string | null;
  replacedAt: Date | null;
  uploadedBy: {
    displayName: string;
  };
  replacedBy: {
    displayName: string;
  } | null;
};

export function buildGameDetailFileVersionPayload(
  fileVersion: GameDetailFileVersionRecord,
) {
  return {
    id: fileVersion.id,
    originalName: fileVersion.originalName,
    uploadedAt: fileVersion.uploadedAt.toISOString(),
    uploadedById: fileVersion.uploadedById,
    uploadedByDisplayName: fileVersion.uploadedBy.displayName,
    contentHash: fileVersion.contentHash,
    idempotencyKey: fileVersion.idempotencyKey,
    replacedAt: fileVersion.replacedAt?.toISOString() ?? null,
    replacedByDisplayName: fileVersion.replacedBy?.displayName ?? null,
  };
}
