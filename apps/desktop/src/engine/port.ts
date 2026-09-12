// The UI's only application boundary. Kept in step with engine/src/lib.rs.
export type Theme = "dark" | "light" | "system";
export type SyncStatus = "conflict" | "sending" | "synchronized" | "archived";
export type CampaignAction =
  "resolve-conflict" | "cancel-automatic-send" | "open-folder";
export type OnboardingStage =
  | "welcome"
  | "sign-in"
  | "companion-root"
  | "automatic-uploads"
  | "review"
  | "complete";

export interface Campaign {
  id: string;
  number: number;
  name: string;
  round: number;
  activeLord: string;
  syncStatus: SyncStatus;
  statusLabel: string;
  detail: string;
  automaticUploads: boolean;
  turnStartedAt: string | null;
  lastTransfer: string;
  actions: CampaignAction[];
}

export interface Snapshot {
  revision: number;
  appVersion: string;
  protocolVersion: string;
  connection: {
    state: "checking" | "connected" | "offline" | "update-required";
    reachable: boolean;
    serverProtocolVersion: string | null;
  };
  session: {
    state: "signed-out" | "waiting-for-browser" | "signed-in";
    authorizationUrl: string | null;
    handoffExpiresAt: string | null;
    credentialStorage: "vault" | "memory-only" | null;
  };
  onboarding: {
    stage: OnboardingStage;
    availableSteps: OnboardingStage[];
    canSend: boolean;
  };
  readOnly: boolean;
  paused: boolean;
  displayName: string | null;
  rootPath: string | null;
  preferences: { theme: Theme; automaticUploads: boolean };
  campaigns: Campaign[];
  activity: {
    id: string;
    campaignName: string;
    description: string;
    occurredAt: string;
  }[];
}

export type Command =
  | { type: "continue-onboarding" }
  | { type: "navigate-onboarding"; stage: OnboardingStage }
  | { type: "start-browser-sign-in" }
  | { type: "submit-handoff-token"; token: string }
  | { type: "choose-companion-root" }
  | { type: "complete-onboarding" }
  | { type: "sign-out" }
  | { type: "reset-companion" }
  | { type: "set-theme"; theme: Theme }
  | { type: "set-automatic-uploads"; enabled: boolean }
  | { type: "set-paused"; paused: boolean }
  | { type: "campaign-action"; campaignId: string; action: CampaignAction };

export interface Companion {
  snapshot(): Promise<Snapshot>;
  command(command: Command): Promise<Snapshot>;
  subscribe(listener: (snapshot: Snapshot) => void): Promise<() => void>;
}
