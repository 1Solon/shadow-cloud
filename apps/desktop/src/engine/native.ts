import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Companion, Snapshot } from "./port";

export const nativeCompanion: Companion = {
  snapshot: () => invoke<Snapshot>("companion_snapshot"),
  command: (command) => invoke<Snapshot>("companion_command", { command }),
  subscribe: (listener) =>
    listen<Snapshot>("companion:snapshot", ({ payload }) => listener(payload)),
};
