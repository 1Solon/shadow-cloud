// COMPANION_DEVELOPMENT_FIXTURE — imported only behind import.meta.env.DEV.
import rootPackage from "../../../../package.json";
import type {
  Campaign,
  Companion,
  OnboardingStage,
  Snapshot,
} from "../engine/port";

const onboardingStages: OnboardingStage[] = [
  "welcome",
  "sign-in",
  "companion-root",
  "automatic-uploads",
  "review",
  "complete",
];

export function createDevelopmentCompanion(scenario: string): Companion {
  const startsOnboarding = scenario === "onboarding";
  let onboardingComplete = !startsOnboarding;
  let furthestOnboardingStep = startsOnboarding ? 0 : 5;
  const campaigns: Campaign[] = [
    {
      id: "black-glass",
      number: 42,
      name: "Black Glass",
      round: 63,
      activeLord: "Mara",
      syncStatus: "conflict",
      statusLabel: "Conflict",
      detail: "Cloud save changed after local work began",
      automaticUploads: true,
      turnStartedAt: "2026-09-11T12:57:00Z",
      lastTransfer: "3 minutes ago",
      actions: ["resolve-conflict", "open-folder"],
    },
    {
      id: "long-meridian",
      number: 107,
      name: "Long Meridian",
      round: 18,
      activeLord: "You",
      syncStatus: "sending",
      statusLabel: "Sends in 00:15",
      detail: "Turn candidate detected and ready to send",
      automaticUploads: true,
      turnStartedAt: "2026-09-11T13:00:00Z",
      lastTransfer: "just now",
      actions: ["cancel-automatic-send", "open-folder"],
    },
    {
      id: "frontier-doctrine",
      number: 18,
      name: "Frontier Doctrine",
      round: 31,
      activeLord: "Iona",
      syncStatus: "synchronized",
      statusLabel: "Synchronized",
      detail: "Latest campaign save received",
      automaticUploads: true,
      turnStartedAt: "2026-09-11T12:48:00Z",
      lastTransfer: "12 minutes ago",
      actions: [],
    },
    {
      id: "dusk-protocol",
      number: 211,
      name: "Dusk Protocol",
      round: 9,
      activeLord: "Rook",
      syncStatus: "synchronized",
      statusLabel: "Synchronized",
      detail: "Three new campaign saves received",
      automaticUploads: false,
      turnStartedAt: "2026-09-11T12:22:00Z",
      lastTransfer: "38 minutes ago",
      actions: [],
    },
    {
      id: "iron-reliquary",
      number: 3,
      name: "Iron Reliquary",
      round: 44,
      activeLord: "—",
      syncStatus: "archived",
      statusLabel: "Archived",
      detail: "Campaign ended; local saves retained",
      automaticUploads: false,
      turnStartedAt: "2026-09-03T13:00:00Z",
      lastTransfer: "8 days ago",
      actions: [],
    },
  ];
  let state: Snapshot = {
    revision: 0,
    appVersion: rootPackage.version,
    protocolVersion: rootPackage.version,
    connection: {
      reachable: scenario !== "offline",
      state:
        scenario === "offline"
          ? "offline"
          : scenario === "update-required"
            ? "update-required"
            : "connected",
      serverProtocolVersion:
        scenario === "update-required" ? "999.0.0" : rootPackage.version,
    },
    session: {
      state: startsOnboarding ? "signed-out" : "signed-in",
      authorizationUrl: null,
      handoffExpiresAt: null,
      credentialStorage: startsOnboarding
        ? null
        : scenario === "memory-only"
          ? "memory-only"
          : "vault",
    },
    onboarding: {
      stage: startsOnboarding ? "welcome" : "complete",
      availableSteps: startsOnboarding ? ["welcome"] : [],
      canSend:
        !startsOnboarding &&
        scenario !== "offline" &&
        scenario !== "update-required" &&
        scenario !== "paused",
    },
    readOnly:
      startsOnboarding ||
      scenario === "offline" ||
      scenario === "update-required" ||
      scenario === "paused",
    paused: scenario === "paused",
    displayName: startsOnboarding ? null : "SOLON",
    rootPath: startsOnboarding ? null : "~/Games/Shadow Cloud",
    preferences: { theme: "dark", automaticUploads: true },
    campaigns,
    activity: [
      {
        id: "candidate",
        campaignName: "107 : Long Meridian",
        description:
          "Turn candidate detected; automatic send starts in 15 seconds.",
        occurredAt: "2026-09-11T13:00:00Z",
      },
      {
        id: "received",
        campaignName: "18 : Frontier Doctrine",
        description: "Turn 30 received and verified.",
        occurredAt: "2026-09-11T12:48:00Z",
      },
      {
        id: "catchup",
        campaignName: "211 : Dusk Protocol",
        description: "Three campaign saves received in order.",
        occurredAt: "2026-09-11T12:22:00Z",
      },
    ],
  };
  const listeners = new Set<(snapshot: Snapshot) => void>();
  const snapshot = () => structuredClone(state);
  return {
    snapshot: async () => snapshot(),
    subscribe: async (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    command: async (command) => {
      const mismatch = state.connection.state === "update-required";
      const requireCompatibleServer = () => {
        if (state.connection.state === "update-required")
          throw "update-required";
        if (state.connection.state !== "connected")
          throw "authentication-unavailable";
      };
      if (
        mismatch &&
        ((command.type === "set-paused" && !command.paused) ||
          (command.type === "set-automatic-uploads" && command.enabled) ||
          command.type === "campaign-action")
      )
        throw "update-required";
      const next = snapshot();
      switch (command.type) {
        case "continue-onboarding":
          if (next.onboarding.stage === "welcome")
            next.onboarding.stage = "sign-in";
          else if (
            next.onboarding.stage === "sign-in" &&
            next.session.state === "signed-in"
          )
            next.onboarding.stage =
              onboardingComplete && next.rootPath
                ? "complete"
                : "companion-root";
          else if (
            next.onboarding.stage === "companion-root" &&
            next.session.state === "signed-in" &&
            next.rootPath
          )
            next.onboarding.stage = "automatic-uploads";
          else if (
            next.onboarding.stage === "automatic-uploads" &&
            next.session.state === "signed-in" &&
            next.rootPath
          )
            next.onboarding.stage = "review";
          else throw "invalid-onboarding-step";
          break;
        case "navigate-onboarding":
          if (!next.onboarding.availableSteps.includes(command.stage))
            throw "invalid-onboarding-step";
          next.onboarding.stage = command.stage;
          break;
        case "start-browser-sign-in":
          requireCompatibleServer();
          if (
            next.onboarding.stage !== "sign-in" ||
            next.session.state === "signed-in"
          )
            throw "invalid-onboarding-step";
          next.session = {
            state: "waiting-for-browser",
            authorizationUrl:
              "https://shadow-cloud.example/api/auth/companion?handoff=development",
            handoffExpiresAt: "2026-09-11T20:10:00Z",
            credentialStorage: null,
          };
          break;
        case "submit-handoff-token":
          if (
            next.onboarding.stage !== "sign-in" ||
            next.session.state === "signed-in"
          )
            throw "invalid-onboarding-step";
          requireCompatibleServer();
          if (!command.token.trim()) throw "authorization-expired";
          next.displayName = "SOLON";
          next.session = {
            state: "signed-in",
            authorizationUrl: null,
            handoffExpiresAt: null,
            credentialStorage: "vault",
          };
          break;
        case "choose-companion-root":
          if (next.session.state !== "signed-in")
            throw "invalid-onboarding-step";
          next.rootPath = "~/Games/Shadow Cloud";
          next.onboarding.stage = onboardingComplete
            ? "complete"
            : "companion-root";
          break;
        case "complete-onboarding":
          if (
            next.onboarding.stage !== "review" ||
            next.session.state !== "signed-in" ||
            !next.rootPath
          )
            throw "invalid-onboarding-step";
          onboardingComplete = true;
          next.onboarding.stage = "complete";
          break;
        case "reset-companion":
        case "sign-out":
          next.displayName = null;
          next.session = {
            state: "signed-out",
            authorizationUrl: null,
            handoffExpiresAt: null,
            credentialStorage: null,
          };
          if (command.type === "reset-companion") {
            onboardingComplete = false;
            furthestOnboardingStep = 0;
            next.onboarding.stage = "welcome";
            next.rootPath = null;
            next.preferences = { theme: "system", automaticUploads: true };
            next.paused = false;
            next.campaigns = [];
            next.activity = [];
          } else {
            next.onboarding.stage = "sign-in";
          }
          break;
        case "set-theme":
          next.preferences.theme = command.theme;
          break;
        case "set-automatic-uploads":
          next.preferences.automaticUploads = command.enabled;
          break;
        case "set-paused":
          next.paused = command.paused;
          break;
        // No file or network side effects, even in development.
        case "campaign-action":
          if (!state.onboarding.canSend) throw "onboarding-incomplete";
          throw "not-available";
      }
      furthestOnboardingStep = Math.max(
        furthestOnboardingStep,
        onboardingStages.indexOf(next.onboarding.stage),
      );
      next.onboarding.availableSteps =
        next.onboarding.stage === "complete"
          ? []
          : onboardingStages.filter((stage, index) => {
              if (stage === "complete" || index > furthestOnboardingStep)
                return false;
              if (stage === "companion-root")
                return next.session.state === "signed-in";
              if (stage === "automatic-uploads" || stage === "review")
                return (
                  next.session.state === "signed-in" && Boolean(next.rootPath)
                );
              return true;
            });
      next.onboarding.canSend =
        onboardingComplete &&
        next.onboarding.stage === "complete" &&
        next.session.state === "signed-in" &&
        Boolean(next.rootPath) &&
        next.connection.state === "connected" &&
        !next.paused;
      next.readOnly = !next.onboarding.canSend;
      if (JSON.stringify(next) !== JSON.stringify(state)) {
        state = { ...next, revision: state.revision + 1 };
        for (const listener of listeners) listener(snapshot());
      }
      return snapshot();
    },
  };
}
