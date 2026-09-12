// COMPANION_DEVELOPMENT_FIXTURE — imported only behind import.meta.env.DEV.
import rootPackage from "../../../../package.json";
import type {
  Campaign,
  Companion,
  OnboardingStage,
  Snapshot,
  UpdateBlocker,
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
  const startsOnboarding =
    scenario === "onboarding" || scenario === "onboarding-update-required";
  const requiresUpdate =
    scenario === "update-required" || scenario === "onboarding-update-required";
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
  for (const campaign of campaigns) {
    campaign.automaticMode = campaign.automaticUploads ? "inherit" : "manual";
    campaign.paused = false;
    campaign.recovery = campaign.syncStatus === "conflict" ? "conflict" : null;
    campaign.recoveryToken = campaign.recovery ? "development-cloud-1" : null;
  }
  if (scenario === "conflict" || scenario === "stale") {
    campaigns.splice(1);
    Object.assign(campaigns[0], {
      activeLord: "You",
      actions: ["resolve-conflict", "open-folder", "open-web"],
      candidates: [
        {
          contentHash: "sha256:development-local",
          filename: "local-turn.se1",
          size: 204800,
          modifiedAt: Date.parse("2026-09-12T14:20:00Z"),
          stable: true,
          ignored: false,
          canSend: false,
        },
      ],
    });
    if (scenario === "stale")
      Object.assign(campaigns[0], {
        recovery: "stale",
        recoveryToken: "development-turn-1",
        syncStatus: "needs-attention",
        statusLabel: "Turn review required",
        detail:
          "The active Seat changed while your Turn candidate was waiting. Review the current turn before sending.",
        actions: ["open-folder", "open-web"],
      });
  }
  if (scenario === "automatic" || scenario === "countdown") {
    campaigns.splice(0, 1);
    campaigns.splice(1);
    Object.assign(campaigns[0], {
      countdown: {
        authorizationId: "development-countdown-1",
        contentHash: "sha256:development-completed",
        remainingSeconds: 15,
      },
      detail:
        "Your completed Turn candidate will send after 15 seconds. Cancel to review it first.",
      candidates: [
        {
          contentHash: "sha256:development-completed",
          filename: "completed-turn.se1",
          size: 204800,
          modifiedAt: Date.parse("2026-09-12T14:20:00Z"),
          stable: true,
          ignored: false,
          canSend: true,
        },
      ],
    });
  }
  if (scenario === "manual" || scenario === "updates") {
    campaigns.splice(1);
    Object.assign(campaigns[0], {
      syncStatus: "needs-attention",
      statusLabel: "Turn candidates",
      activeLord: "You",
      automaticUploads: false,
      automaticMode: "manual",
      recovery: null,
      recoveryToken: null,
      detail:
        "Select the completed turn to send. Your original files stay in this folder.",
      actions: ["open-folder"],
      candidates: [
        {
          contentHash: "sha256:development-first",
          filename: "completed-turn.se1",
          size: 204800,
          modifiedAt: Date.parse("2026-09-12T14:20:00Z"),
          stable: true,
          ignored: false,
          canSend: true,
        },
        {
          contentHash: "sha256:development-second",
          filename: "work-in-progress.se1",
          size: 102400,
          modifiedAt: Date.parse("2026-09-12T14:22:00Z"),
          stable: false,
          ignored: false,
          canSend: false,
        },
      ],
    });
  }
  if (scenario === "onboarding-update-required") campaigns.splice(0);
  if (scenario === "receiving") {
    campaigns[0] = {
      ...campaigns[0],
      syncStatus: "needs-attention",
      recovery: null,
      recoveryToken: null,
      statusLabel: "Current save missing",
      detail:
        "The current received save was deleted. Redownload it when needed.",
      actions: ["redownload-current", "open-folder"],
    };
    campaigns[1] = {
      ...campaigns[1],
      syncStatus: "receiving",
      statusLabel: "Receiving publications",
      detail: "Catching up saves received while this Companion was offline.",
      actions: [],
    };
  }
  let state: Snapshot = {
    desktop: {
      trayAvailable: scenario !== "native-unavailable",
      startAtLoginAvailable: scenario !== "native-unavailable",
    },
    updates: {
      state: "idle",
      version: null,
      offerId: null,
      installBlockers: [],
      detail: null,
    },
    diagnostics: null,
    revision: 0,
    appVersion: rootPackage.version,
    protocolVersion: rootPackage.version,
    connection: {
      reachable: scenario !== "offline",
      state:
        scenario === "offline"
          ? "offline"
          : requiresUpdate
            ? "update-required"
            : "connected",
      serverProtocolVersion: requiresUpdate ? "999.0.0" : rootPackage.version,
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
        !requiresUpdate &&
        scenario !== "paused",
    },
    readOnly:
      startsOnboarding ||
      scenario === "offline" ||
      requiresUpdate ||
      scenario === "paused",
    paused: scenario === "paused",
    displayName: startsOnboarding ? null : "SOLON",
    rootPath: startsOnboarding ? null : "~/Games/Shadow Cloud",
    preferences: {
      theme: "dark",
      automaticUploads: true,
      updateChannel: "stable",
      startAtLogin: false,
      keepRunningInTray: true,
    },
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
  const projectUpdateBlockers = (snapshot: Snapshot) => {
    const blockers = new Set<UpdateBlocker>();
    for (const campaign of snapshot.campaigns) {
      const countdown =
        Boolean(campaign.countdown) ||
        campaign.statusLabel.startsWith("Sends in");
      if (countdown) blockers.add("countdown");
      if (
        campaign.syncStatus === "receiving" ||
        (campaign.syncStatus === "sending" && !countdown)
      )
        blockers.add("transfer");
      if (campaign.recovery === "conflict") blockers.add("conflict");
    }
    snapshot.updates.installBlockers =
      scenario === "update-blocked"
        ? ["countdown", "transfer", "uncertain-submission", "conflict"]
        : [...blockers];
  };
  projectUpdateBlockers(state);
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
          (command.type === "campaign-action" && command.action !== "open-web"))
      )
        throw "update-required";
      const next = snapshot();
      const cancelCountdown = (campaign: Campaign) => {
        campaign.countdown = null;
        campaign.syncStatus = "needs-attention";
        campaign.statusLabel = "Automatic send cancelled";
        campaign.detail = "Review this Turn candidate and send it when ready.";
        campaign.actions = campaign.actions.filter(
          (action) => action !== "cancel-automatic-send",
        );
      };
      switch (command.type) {
        case "set-update-channel":
          if (next.updates.state === "installing") throw "not-available";
          next.preferences.updateChannel = command.channel;
          next.updates.state = "idle";
          next.updates.version = null;
          next.updates.offerId = null;
          next.updates.detail = null;
          break;
        case "install-update":
          if (
            next.updates.state !== "available" ||
            next.updates.offerId !== command.offerId ||
            next.updates.installBlockers.length
          )
            throw "not-available";
          next.updates.state = "installing";
          next.updates.offerId = null;
          next.updates.detail =
            "Synthetic update confirmed. This development scenario does not install software or restart.";
          break;
        case "set-start-at-login":
          if (!next.desktop.startAtLoginAvailable) throw "not-available";
          next.preferences.startAtLogin = command.enabled;
          break;
        case "set-keep-running-in-tray":
          if (!next.desktop.trayAvailable) throw "not-available";
          next.preferences.keepRunningInTray = command.enabled;
          break;
        case "check-for-updates":
          if (next.updates.state === "installing") throw "not-available";
          next.updates.state = "available";
          next.updates.version =
            next.preferences.updateChannel === "stable"
              ? "0.17.0"
              : "0.18.0-beta.1";
          next.updates.offerId = `development-${next.preferences.updateChannel}-${next.revision + 1}`;
          next.updates.detail = null;
          break;
        case "resolve-campaign": {
          const campaign = next.campaigns.find(
            (c) => c.id === command.campaignId,
          );
          if (!campaign) throw "not-available";
          if (command.action === "keep-local-and-pause") {
            campaign.paused = true;
            campaign.countdown = null;
            campaign.statusLabel = "Campaign paused";
            break;
          }
          requireCompatibleServer();
          if (
            next.paused ||
            campaign.paused ||
            command.reviewToken !== campaign.recoveryToken
          )
            throw "not-available";
          if (command.action === "use-latest") {
            if (campaign.recovery !== "conflict") throw "not-available";
            campaign.recovery = null;
            campaign.recoveryToken = null;
            campaign.candidates = [];
            campaign.syncStatus = "synchronized";
            campaign.statusLabel =
              "Local work preserved; current cloud save received.";
            campaign.detail = "Local work is available in the conflict area.";
            campaign.actions = ["open-folder", "open-web"];
          } else if (command.action === "review-current-turn") {
            if (campaign.recovery !== "stale") throw "not-available";
            campaign.recovery = null;
            campaign.recoveryToken = null;
            campaign.countdown = null;
            campaign.statusLabel = "Turn candidates";
            campaign.detail =
              "Review complete. Select Send to authorize your completed Turn candidate.";
            for (const candidate of campaign.candidates ?? [])
              candidate.canSend = candidate.stable && !candidate.ignored;
          }
          break;
        }
        case "set-campaign-paused": {
          const campaign = next.campaigns.find(
            (c) => c.id === command.campaignId,
          );
          if (!campaign) throw "not-available";
          if (!command.paused && mismatch) throw "update-required";
          campaign.paused = command.paused;
          if (command.paused) campaign.countdown = null;
          campaign.statusLabel = command.paused
            ? "Campaign paused"
            : campaign.recovery === "conflict"
              ? "Conflict"
              : "Turn candidates";
          break;
        }
        case "generate-diagnostics":
          next.diagnostics = JSON.stringify(
            {
              schema: 1,
              appVersion: next.appVersion,
              connection: next.connection.state,
              paused: next.paused,
              campaigns: next.campaigns.length,
              pendingSubmissions: 0,
            },
            null,
            2,
          );
          break;
        case "cancel-automatic-send": {
          const campaign = next.campaigns.find(
            (c) => c.id === command.campaignId,
          );
          if (campaign?.countdown?.authorizationId === command.authorizationId)
            cancelCountdown(campaign);
          break;
        }
        case "candidate-action": {
          const campaign = next.campaigns.find(
            (c) => c.id === command.campaignId,
          );
          const candidate = campaign?.candidates?.find(
            (c) => c.contentHash === command.contentHash,
          );
          if (!campaign || !candidate) throw "not-available";
          if (command.action === "send") {
            if (
              !candidate.canSend ||
              campaign.recovery ||
              campaign.paused ||
              next.readOnly
            )
              throw "not-available";
            campaign.candidates = campaign.candidates?.filter(
              (c) => c !== candidate,
            );
            campaign.statusLabel = "Submission accepted";
            campaign.syncStatus = "synchronized";
            campaign.countdown = null;
            campaign.actions = campaign.actions.filter(
              (action) => action !== "cancel-automatic-send",
            );
          } else {
            candidate.ignored = command.action === "ignore";
            candidate.canSend =
              !candidate.ignored &&
              candidate.stable &&
              !campaign.recovery &&
              !campaign.paused;
            if (campaign.countdown) cancelCountdown(campaign);
          }
          break;
        }
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
          next.diagnostics = null;
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
            next.preferences = {
              theme: "system",
              automaticUploads: true,
              updateChannel: "stable",
              startAtLogin: false,
              keepRunningInTray: true,
            };
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
          for (const campaign of next.campaigns) {
            if (campaign.automaticMode === "inherit") {
              campaign.automaticUploads = command.enabled;
              if (!command.enabled && campaign.countdown)
                cancelCountdown(campaign);
            }
          }
          break;
        case "set-campaign-automatic-uploads": {
          const campaign = next.campaigns.find(
            (c) => c.id === command.campaignId,
          );
          if (!campaign) throw "not-available";
          campaign.automaticMode = command.mode;
          campaign.automaticUploads =
            command.mode === "inherit"
              ? next.preferences.automaticUploads
              : command.mode === "automatic";
          if (!campaign.automaticUploads && campaign.countdown)
            cancelCountdown(campaign);
          break;
        }
        case "set-paused":
          next.paused = command.paused;
          break;
        // No file or network side effects, even in development.
        case "campaign-action":
          if (command.action === "open-web") break;
          if (!state.onboarding.canSend) throw "onboarding-incomplete";
          if (command.action === "redownload-current") {
            const campaign = next.campaigns.find(
              (c) => c.id === command.campaignId,
            );
            if (!campaign) throw "not-available";
            campaign.syncStatus = "synchronized";
            campaign.statusLabel = "Synchronized";
            campaign.detail = "Current save received and verified.";
            campaign.actions = ["open-folder"];
            break;
          }
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
      projectUpdateBlockers(next);
      if (JSON.stringify(next) !== JSON.stringify(state)) {
        state = { ...next, revision: state.revision + 1 };
        for (const listener of listeners) listener(snapshot());
      }
      return snapshot();
    },
  };
}
