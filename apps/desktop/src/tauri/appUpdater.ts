import {
  check as checkTauriUpdate,
  type Update,
} from "@tauri-apps/plugin-updater";

type DesktopUpdate = Pick<Update, "version" | "downloadAndInstall">;

type UpdateCheckStatus = "up-to-date" | "installed" | "cancelled";

export type UpdateCheckResult = {
  status: UpdateCheckStatus;
  message: string;
};

type CheckForUpdate = () => Promise<DesktopUpdate | null>;
type ConfirmInstall = (message: string) => boolean | Promise<boolean>;

type CheckForDesktopUpdateOptions = {
  check?: CheckForUpdate;
  confirmInstall?: ConfirmInstall;
};

function defaultConfirmInstall(message: string) {
  return window.confirm(message);
}

export async function checkForDesktopUpdate({
  check = checkTauriUpdate,
  confirmInstall = defaultConfirmInstall,
}: CheckForDesktopUpdateOptions = {}): Promise<UpdateCheckResult> {
  const update = await check();

  if (!update) {
    return {
      status: "up-to-date",
      message: "Shadow Cloud Local is up to date.",
    };
  }

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
