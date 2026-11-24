import type { PasswordResetApprovalSummary } from './password-reset-approval';

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
  approval: PasswordResetApprovalSummary | null;
};

function latestCorrection(
  fileVersion: GameDetailFileVersionRecord,
  passwordResets: FileVersionPasswordResetRecord[],
) {
  for (const reset of passwordResets) {
    if (reset.fileVersionId !== fileVersion.id) continue;
    if (reset.outputRevision === fileVersion.contentRevision)
      return {
        reason: reset.reason ?? reset.approval?.reason ?? null,
        approval: reset.approval
          ? {
              approverDisplayName: reset.approval.approverDisplayName,
              approverRole: reset.approval.approverRole,
            }
          : null,
      };
    if (reset.undoRevision === fileVersion.contentRevision)
      return { reason: reset.undoReason, approval: null };
  }
  return { reason: null, approval: null };
}

export function buildGameDetailFileVersionPayload(
  fileVersion: GameDetailFileVersionRecord,
  passwordResets: FileVersionPasswordResetRecord[],
) {
  const correction = latestCorrection(fileVersion, passwordResets);
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
    replacementReason: correction.reason,
    replacementApproval: correction.approval,
  };
}
