export type SaveInspection = {
  fileVersionId: string;
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
