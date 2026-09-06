export const transferOutcomeMessages = {
  "metadata-saved-transfer-failed":
    "Campaign details saved; Overlord transfer failed.",
  "metadata-saved-transfer-unconfirmed":
    "Campaign details saved; Overlord transfer could not be confirmed.",
  "transfer-unconfirmed": "Overlord transfer could not be confirmed.",
} as const;

export type TransferOutcome = keyof typeof transferOutcomeMessages;

// Status alone is insufficient: callers must still validate the response body.
export function isKnownRejectionStatus(status: number) {
  return [400, 401, 403, 404, 409, 422].includes(status);
}

export function transferOutcomeMessage(
  value: unknown,
  read: "reloaded" | "unavailable" = "reloaded",
) {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(transferOutcomeMessages, value)
  )
    return null;
  const summary = transferOutcomeMessages[value as TransferOutcome];
  return read === "reloaded" && value.endsWith("unconfirmed")
    ? `${summary} Current ownership has been reloaded. Choose a transfer target afresh if needed.`
    : summary;
}
