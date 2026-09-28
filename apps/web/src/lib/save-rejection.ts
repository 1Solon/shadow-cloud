export type SaveRejectionLabel = "Reject" | "Withdraw";

type GetSaveRejectionLabelInput = {
  currentUserId: string | null;
  latestSave: { id: string; uploadedById: string } | null;
  rejectableSaveId: string | null;
  activePlayerUserId: string | null;
  organizerId: string;
  isShadowOverrideUser: boolean;
  shadowOverrideEnabled: boolean;
};

export function getSaveRejectionLabel({
  currentUserId,
  latestSave,
  rejectableSaveId,
  activePlayerUserId,
  organizerId,
  isShadowOverrideUser,
  shadowOverrideEnabled,
}: GetSaveRejectionLabelInput): SaveRejectionLabel | null {
  if (!currentUserId || !latestSave || latestSave.id !== rejectableSaveId) {
    return null;
  }

  if (currentUserId === latestSave.uploadedById) {
    return "Withdraw";
  }

  return currentUserId === activePlayerUserId ||
    currentUserId === organizerId ||
    (isShadowOverrideUser && shadowOverrideEnabled)
    ? "Reject"
    : null;
}
