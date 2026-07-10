type CanReplaceSaveFileInput = {
  currentUserId: string | null;
  uploadedById: string;
  isShadowOverrideUser: boolean;
  shadowOverrideEnabled: boolean;
};

export function canReplaceSaveFile({
  currentUserId,
  uploadedById,
  isShadowOverrideUser,
  shadowOverrideEnabled,
}: CanReplaceSaveFileInput) {
  return Boolean(
    currentUserId &&
    (currentUserId === uploadedById ||
      (isShadowOverrideUser && shadowOverrideEnabled)),
  );
}
