import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { desktopVersion } from "./appVersion";

describe("desktopVersion", () => {
  it("uses the desktop package version", () => {
    expect(desktopVersion).toBe(packageJson.version);
    expect(desktopVersion).not.toBe("unknown");
  });
});
