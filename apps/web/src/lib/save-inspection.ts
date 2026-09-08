export type SaveInspection = {
  fileVersionId: string;
  contentRevision: number;
  sourceId: string;
  expectedSaveBaseline: string;
  regimes: {
    id: string;
    name: string;
    current: boolean;
    eligible: boolean;
    reason: string | null;
  }[];
};

export type PasswordRecovery = {
  resetId: string;
  outputId: string;
  outputRevision: number;
  expectedSaveBaseline: string;
  regimeName: string;
};

export type PasswordReceipt = {
  resetId: string;
  fileVersionId: string;
  contentRevision: number;
  regimeName: string;
  replacedAt: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isSaveInspection(value: unknown): value is SaveInspection {
  return (
    record(value) &&
    text(value.fileVersionId) &&
    revision(value.contentRevision) &&
    text(value.sourceId) &&
    text(value.expectedSaveBaseline) &&
    Array.isArray(value.regimes) &&
    value.regimes.every(
      (regime: unknown) =>
        record(regime) &&
        text(regime.id) &&
        text(regime.name) &&
        typeof regime.current === "boolean" &&
        typeof regime.eligible === "boolean" &&
        (regime.reason === null || typeof regime.reason === "string"),
    )
  );
}

export function isPasswordRecovery(
  value: unknown,
): value is { undo: PasswordRecovery | null } {
  if (!record(value)) return false;
  const undo = value.undo;
  return (
    undo === null ||
    (record(undo) &&
      text(undo.resetId) &&
      text(undo.outputId) &&
      revision(undo.outputRevision) &&
      text(undo.expectedSaveBaseline) &&
      text(undo.regimeName))
  );
}

export function isPasswordReceipt(value: unknown): value is PasswordReceipt {
  return (
    record(value) &&
    text(value.resetId) &&
    text(value.fileVersionId) &&
    revision(value.contentRevision) &&
    value.contentRevision > 0 &&
    text(value.regimeName) &&
    text(value.replacedAt) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      value.replacedAt,
    ) &&
    Number.isFinite(Date.parse(value.replacedAt))
  );
}
