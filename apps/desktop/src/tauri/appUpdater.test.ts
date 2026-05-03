import { describe, expect, it, vi } from "vitest";
import { checkForDesktopUpdate } from "./appUpdater";

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
