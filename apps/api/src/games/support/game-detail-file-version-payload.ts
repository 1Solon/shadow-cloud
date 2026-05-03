export type GameDetailFileVersionRecord = {
  id: string;
  originalName: string;
  uploadedAt: Date;
  uploadedById: string;
  uploadedBy: {
    displayName: string;
  };
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
  };
}
