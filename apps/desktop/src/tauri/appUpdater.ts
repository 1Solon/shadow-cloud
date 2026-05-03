import {
  check as checkTauriUpdate,
  type Update,
} from "@tauri-apps/plugin-updater";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";

type DesktopUpdate = Pick<Update, "version" | "downloadAndInstall">;

type UpdateCheckStatus = "up-to-date" | "installed" | "cancelled";

export type UpdateCheckResult = {
  status: UpdateCheckStatus;
  message: string;
};

type CheckForUpdate = () => Promise<DesktopUpdate | null>;
type ConfirmInstall = (message: string) => boolean | Promise<boolean>;
type UpdateAvailableHandler = (version: string) => void;

type CheckForDesktopUpdateOptions = {
  check?: CheckForUpdate;
  confirmInstall?: ConfirmInstall;
  onUpdateAvailable?: UpdateAvailableHandler;
};

function defaultConfirmInstall(message: string) {
  return confirmDialog(message, {
    title: "Shadow Cloud Local",
    kind: "info",
    okLabel: "Install",
    cancelLabel: "Cancel",
  });
}

export async function checkForDesktopUpdate({
  check = checkTauriUpdate,
  confirmInstall = defaultConfirmInstall,
  onUpdateAvailable,
}: CheckForDesktopUpdateOptions = {}): Promise<UpdateCheckResult> {
  const update = await check();

  if (!update) {
    return {
      status: "up-to-date",
      message: "Shadow Cloud Local is up to date.",
    };
  }

  onUpdateAvailable?.(update.version);

  const shouldInstall = await confirmInstall(
    `Update ${update.version} is available. Download and install it now?`,
  );

  if (!shouldInstall) {
    return {
      status: "cancelled",
      message: "Update cancelled.",
    };
  }

  await update.downloadAndInstall();

  return {
    status: "installed",
    message: `Update ${update.version} installed. Restart Shadow Cloud Local to finish.`,
  };
}
