// The UI's only application boundary. Kept in step with engine/src/lib.rs.
export type Theme = "dark" | "light" | "system";
export type AutomaticMode = "inherit" | "automatic" | "manual";
export type SyncStatus =
  | "conflict"
  | "sending"
  | "synchronized"
  | "archived"
  | "receiving"
  | "needs-attention";
export type CampaignAction =
  | "resolve-conflict"
  | "cancel-automatic-send"
  | "open-folder"
  | "open-web"
  | "redownload-current";
export type OnboardingStage =
  | "welcome"
  | "sign-in"
  | "companion-root"
  | "automatic-uploads"
  | "review"
  | "complete";

export interface Campaign {
  paused?: boolean;
  recovery?: "conflict" | "stale" | null;
  recoveryToken?: string | null;
  countdown?: {
    authorizationId: string;
    contentHash: string;
    remainingSeconds: number;
  } | null;
  candidates?: {
    contentHash: string;
    filename: string;
    size: number;
    modifiedAt: number;
    stable: boolean;
    ignored: boolean;
    canSend: boolean;
  }[];
  id: string;
  number: number;
  name: string;
  round: number;
  activeLord: string;
  syncStatus: SyncStatus;
  statusLabel: string;
  detail: string;
  automaticUploads: boolean;
  automaticMode?: AutomaticMode;
  turnStartedAt: string | null;
  lastTransfer: string;
  archiveBytes?: number;
  actions: CampaignAction[];
}

export interface Snapshot {
  diagnostics?: string | null;
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
  | { type: "generate-diagnostics" }
  | {
      type: "resolve-campaign";
      campaignId: string;
      action: "use-latest" | "keep-local-and-pause" | "review-current-turn";
      reviewToken?: string;
    }
  | {
      type: "cancel-automatic-send";
      campaignId: string;
      authorizationId: string;
    }
  | {
      type: "candidate-action";
      campaignId: string;
      contentHash: string;
      action: "send" | "ignore" | "restore";
    }
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
  | {
      type: "set-campaign-automatic-uploads";
      campaignId: string;
      mode: AutomaticMode;
    }
  | { type: "set-paused"; paused: boolean }
  | { type: "set-campaign-paused"; campaignId: string; paused: boolean }
  | { type: "campaign-action"; campaignId: string; action: CampaignAction };

export interface Companion {
  snapshot(): Promise<Snapshot>;
  command(command: Command): Promise<Snapshot>;
  subscribe(listener: (snapshot: Snapshot) => void): Promise<() => void>;
}
