// COMPANION_DEVELOPMENT_FIXTURE — imported only behind import.meta.env.DEV.
import rootPackage from "../../../../package.json";
import type { Campaign, Companion, Snapshot } from "../engine/port";

export function createDevelopmentCompanion(scenario: string): Companion {
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
    readOnly: scenario === "offline" || scenario === "update-required",
    paused: scenario === "paused",
    displayName: "SOLON",
    rootPath: "~/Games/Shadow Cloud",
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
      if (
        mismatch &&
        ((command.type === "set-paused" && !command.paused) ||
          (command.type === "set-automatic-uploads" && command.enabled) ||
          command.type === "campaign-action")
      )
        throw "update-required";
      const next = snapshot();
      switch (command.type) {
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
          throw "not-available";
      }
      if (JSON.stringify(next) !== JSON.stringify(state)) {
        state = { ...next, revision: state.revision + 1 };
        for (const listener of listeners) listener(snapshot());
      }
      return snapshot();
    },
  };
}
