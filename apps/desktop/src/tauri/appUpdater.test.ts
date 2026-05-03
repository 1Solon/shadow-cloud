import { describe, expect, it, vi } from "vitest";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { checkForDesktopUpdate } from "./appUpdater";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
}));

describe("checkForDesktopUpdate", () => {
  it("reports when there is no available update", async () => {
    const result = await checkForDesktopUpdate({
      check: async () => null,
      confirmInstall: vi.fn(),
    });

    expect(result).toEqual({
      status: "up-to-date",
      message: "Shadow Cloud Local is up to date.",
    });
  });

  it("downloads and installs an available update when confirmed", async () => {
    const downloadAndInstall = vi.fn();
    const result = await checkForDesktopUpdate({
      check: async () => ({
        version: "0.8.0",
        downloadAndInstall,
      }),
      confirmInstall: async () => true,
    });

    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(result).toEqual({
      status: "installed",
      message: "Update 0.8.0 installed. Restart Shadow Cloud Local to finish.",
    });
  });

  it("uses the Tauri dialog confirmation by default", async () => {
    const downloadAndInstall = vi.fn();
    vi.mocked(confirmDialog).mockResolvedValue(true);

    await checkForDesktopUpdate({
      check: async () => ({
        version: "0.8.0",
        downloadAndInstall,
      }),
    });

    expect(confirmDialog).toHaveBeenCalledWith(
      "Update 0.8.0 is available. Download and install it now?",
      {
        title: "Shadow Cloud Local",
        kind: "info",
        okLabel: "Install",
        cancelLabel: "Cancel",
      },
    );
    expect(downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("does not install an available update when cancelled", async () => {
    const downloadAndInstall = vi.fn();
    const result = await checkForDesktopUpdate({
      check: async () => ({
        version: "0.8.0",
        downloadAndInstall,
      }),
      confirmInstall: async () => false,
    });

    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "cancelled",
      message: "Update cancelled.",
    });
  });
});
